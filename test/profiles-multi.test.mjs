// test/profiles-multi.test.mjs — safety wiring bite 9
// (safety-gap-map §7): child profiles inside one account.
//
// Through bite 8 an account was one tenant with exactly one profile
// row — households could not hold two children with different age
// bands or safety settings. Bite 9 makes profiles a collection under
// the tenant (sql/store/007: profile_id, is_primary, is_active) and
// pins the foundation here, at the lib + handler level, against the
// real code and the FakeDb:
//
//   - an existing account is unchanged: its one profile is primary
//     AND active, and resolution behaves byte-for-byte as before;
//   - two profiles with different postures resolve differently —
//     the ACTIVE one decides, never the sibling;
//   - an explicit profileId is validated against the tenant: a
//     foreign or missing id resolves to the safe default, writes
//     nothing, and moves nothing;
//   - the parent PIN stays ONE account-level lock (stored on the
//     primary profile): it arms per profile (bite 8) and gates
//     safety-off per profile, and a child row's own empty hash is
//     not a bypass;
//   - switching the active profile away from a protected profile
//     takes the same PIN as turning safety off;
//   - the household limit holds, and account deletion erases every
//     profile (the map's bite-9 proof point).
//
// The prime-level proof (the primed voice prompt follows the active
// profile across a switch) lives at the bottom of this file and runs
// the real prime handler in a child process — see
// test/fixtures/profiles-multi-prime-child.mjs. Client selection UI
// is the next bite; nothing here primes from a client-supplied
// profile id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  getProfile, getProfileById, listProfiles, createProfile, upsertProfile,
  setActiveProfile, setParentPin, verifyParentPin, hasParentPin,
  resolveProfileSafety, PROFILES_PER_TENANT_LIMIT,
} from '../lib/profile.js';
import { createAccount, deleteAccount } from '../lib/accounts.js';
import { signSession } from '../lib/tenant.js';
import { handleProfile } from '../server/handlers/profile.js';
import { FakeDb } from './fake-db.mjs';

const SECRET = 'profiles-multi-test-secret';
process.env.SESSION_SECRET = SECRET;

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

function authedReq(tenantId, { method = 'GET', url = 'http://local/api/profile', body = {} } = {}) {
  return {
    method,
    url,
    headers: { authorization: `Bearer ${signSession(tenantId, SECRET)}` },
    body,
  };
}

async function makeAccount(db) {
  const { tenantId } = await createAccount(db, {
    email: `u${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'a long passphrase',
  });
  return tenantId;
}

/** A household: primary profile is a 6-8 kid; second is an adult. */
async function makeHousehold(db) {
  const tenantId = await makeAccount(db);
  await upsertProfile(db, tenantId, { display_name: 'Kid', age_band: '6-8' });
  const second = await createProfile(db, tenantId, { display_name: 'Dad', age_band: 'adult' });
  const primary = await getProfile(db, tenantId);
  return { tenantId, primary, second };
}

// ─── The existing account is unchanged ──────────────────────────────

test('bite 9: a pre-existing account\'s one profile is primary + active, and resolution is unchanged', async () => {
  const db = new FakeDb();
  const tenantId = await makeAccount(db);
  await upsertProfile(db, tenantId, { display_name: 'Sam', age_band: '6-8', safety_mode: false });

  const row = await getProfile(db, tenantId);
  assert.equal(typeof row.profile_id, 'string');
  assert.ok(row.profile_id.length > 0);
  assert.equal(row.is_primary, true);
  assert.equal(row.is_active, true);
  assert.equal((await listProfiles(db, tenantId)).length, 1);

  const r = await resolveProfileSafety(db, tenantId);
  assert.equal(r.source, 'profile');
  assert.deepEqual(r.decision, { failClosed: true, kidCore: true });
  assert.equal(r.profile.profile_id, row.profile_id);
});

// ─── Plural profiles, per-profile resolution ────────────────────────

test('bite 9: createProfile adds a sibling without disturbing the active profile', async () => {
  const db = new FakeDb();
  const { tenantId, primary, second } = await makeHousehold(db);
  assert.equal(second.is_primary, false);
  assert.equal(second.is_active, false);
  assert.notEqual(second.profile_id, primary.profile_id);

  const list = await listProfiles(db, tenantId);
  assert.deepEqual(list.map((p) => p.profile_id), [primary.profile_id, second.profile_id]);
  assert.equal((await getProfile(db, tenantId)).profile_id, primary.profile_id);
});

test('bite 9: the resolver follows the ACTIVE profile across a switch — never the sibling', async () => {
  const db = new FakeDb();
  const { tenantId, primary, second } = await makeHousehold(db);

  const before = await resolveProfileSafety(db, tenantId);
  assert.deepEqual(before.decision, { failClosed: true, kidCore: true }); // the 6-8 kid is active
  assert.equal(before.profile.profile_id, primary.profile_id);

  await setActiveProfile(db, tenantId, second.profile_id);
  const after = await resolveProfileSafety(db, tenantId);
  assert.deepEqual(after.decision, { failClosed: false, kidCore: false }); // the adult now decides
  assert.equal(after.profile.profile_id, second.profile_id);
  assert.deepEqual(after.inputs, { safetyMode: false, ageBand: 'adult' });

  await setActiveProfile(db, tenantId, primary.profile_id);
  const back = await resolveProfileSafety(db, tenantId);
  assert.deepEqual(back.decision, { failClosed: true, kidCore: true });
  assert.equal(back.profile.profile_id, primary.profile_id);
});

test('bite 9: an explicit profileId resolves THAT profile of the tenant, active or not', async () => {
  const db = new FakeDb();
  const { tenantId, primary, second } = await makeHousehold(db);

  const namedAdult = await resolveProfileSafety(db, tenantId, second.profile_id);
  assert.equal(namedAdult.source, 'profile');
  assert.deepEqual(namedAdult.decision, { failClosed: false, kidCore: false });

  await setActiveProfile(db, tenantId, second.profile_id);
  const namedKid = await resolveProfileSafety(db, tenantId, primary.profile_id);
  assert.equal(namedKid.source, 'profile');
  assert.deepEqual(namedKid.decision, { failClosed: true, kidCore: true });
});

test('bite 9: a foreign or missing profileId resolves to the safe default — never a sibling, never the foreign posture', async () => {
  const db = new FakeDb();
  const a = await makeHousehold(db); // tenant A: adult sibling exists; kid primary active
  const b = await makeAccount(db);
  await upsertProfile(db, b, { display_name: 'Bee', age_band: 'adult' });
  const bProfile = await getProfile(db, b);

  // Tenant A names tenant B's (adult, neutral) profile: if the
  // resolver crossed the tenant line, the decision would come back
  // neutral with source 'profile'. It must come back as the safe
  // default instead — more protective, never less.
  const foreign = await resolveProfileSafety(db, a.tenantId, bProfile.profile_id);
  assert.equal(foreign.source, 'no-profile');
  assert.equal(foreign.profile, null);
  assert.equal(foreign.safeDefault, true);
  assert.deepEqual(foreign.decision, { failClosed: true, kidCore: true });

  const missing = await resolveProfileSafety(db, a.tenantId, '00000000-0000-4000-8000-000000000099');
  assert.equal(missing.source, 'no-profile');
  assert.equal(missing.profile, null);
});

test('bite 9: setActiveProfile refuses a foreign or missing profile and moves nothing', async () => {
  const db = new FakeDb();
  const { tenantId, primary } = await makeHousehold(db);
  const other = await makeAccount(db);
  const otherProfile = await getProfile(db, other);

  await assert.rejects(
    setActiveProfile(db, tenantId, otherProfile.profile_id),
    (e) => e.code === 'profile_not_found',
  );
  await assert.rejects(
    setActiveProfile(db, tenantId, '00000000-0000-4000-8000-000000000099'),
    (e) => e.code === 'profile_not_found',
  );
  assert.equal((await getProfile(db, tenantId)).profile_id, primary.profile_id);
});

test('bite 9: upsertProfile with a foreign profileId writes nothing and throws profile_not_found', async () => {
  const db = new FakeDb();
  const { tenantId } = await makeHousehold(db);
  const other = await makeAccount(db);
  const otherProfile = await getProfile(db, other);

  await assert.rejects(
    upsertProfile(db, tenantId, { display_name: 'Hacked' }, otherProfile.profile_id),
    (e) => e.code === 'profile_not_found',
  );
  assert.equal((await getProfile(db, other)).display_name, null);
});

// ─── The PIN stays one account-level lock ───────────────────────────

test('bite 9: the parent PIN lives on the primary profile only, and verifies whichever profile is active', async () => {
  const db = new FakeDb();
  const { tenantId, primary, second } = await makeHousehold(db);
  await setParentPin(db, tenantId, '2468');

  const storedPrimary = await getProfileById(db, tenantId, primary.profile_id);
  const storedSecond = await getProfileById(db, tenantId, second.profile_id);
  assert.ok(storedPrimary.parent_pin_hash);
  assert.equal(storedSecond.parent_pin_hash, null); // never duplicated per profile
  assert.equal(await hasParentPin(db, tenantId), true);
  assert.equal(await verifyParentPin(db, tenantId, '2468'), true);
  assert.equal(await verifyParentPin(db, tenantId, '0000'), false);

  await setActiveProfile(db, tenantId, second.profile_id);
  assert.equal(await verifyParentPin(db, tenantId, '2468'), true); // the lock follows the account
});

test('bite 9: the household limit holds — the profile past the limit is refused', async () => {
  const db = new FakeDb();
  const tenantId = await makeAccount(db); // primary is profile #1
  for (let i = 0; i < PROFILES_PER_TENANT_LIMIT - 1; i++) {
    await createProfile(db, tenantId, { display_name: `P${i}`, age_band: 'adult' });
  }
  assert.equal((await listProfiles(db, tenantId)).length, PROFILES_PER_TENANT_LIMIT);
  await assert.rejects(
    createProfile(db, tenantId, { display_name: 'One too many', age_band: 'adult' }),
    (e) => e.code === 'profile_limit_reached',
  );
});

test('bite 9: account deletion erases every profile in the household', async () => {
  const db = new FakeDb();
  const { tenantId } = await makeHousehold(db);
  const other = await makeAccount(db);

  const { deletedRows } = await deleteAccount(db, tenantId);
  assert.equal(deletedRows.profiles, 2); // the map's proof: both profiles go away
  assert.equal(db.profiles.has(tenantId), false);
  assert.equal((await listProfiles(db, tenantId)).length, 0);
  assert.equal(db.profiles.has(other), true);
  assert.equal((await listProfiles(db, other)).length, 1);
});

// ─── Handler level: the profile routes ──────────────────────────────

test('bite 9 handler: GET /api/profile/profiles lists the household — ids, flags, account pin_set, no hash', async () => {
  const db = new FakeDb();
  const { tenantId, primary, second } = await makeHousehold(db);
  await setParentPin(db, tenantId, '2468');

  const res = fakeRes();
  await handleProfile(authedReq(tenantId, { url: 'http://local/api/profile/profiles' }), res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.profiles.length, 2);
  const [p1, p2] = res.body.profiles;
  assert.equal(p1.profile_id, primary.profile_id);
  assert.equal(p1.is_primary, true);
  assert.equal(p1.is_active, true);
  assert.equal(p2.profile_id, second.profile_id);
  assert.equal(p2.is_primary, false);
  // pin_set is the ACCOUNT's lock state on every serialized profile.
  assert.equal(p1.pin_set, true);
  assert.equal(p2.pin_set, true);
  const stored = await getProfileById(db, tenantId, primary.profile_id);
  assert.ok(!JSON.stringify(res.body).includes(stored.parent_pin_hash));
});

test('bite 9 handler: create via POST /profiles, switch via POST /active, GET follows the switch', async () => {
  const db = new FakeDb();
  const tenantId = await makeAccount(db);
  await upsertProfile(db, tenantId, { display_name: 'Kid', age_band: '6-8' });

  const created = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/profiles',
    body: { display_name: 'Dad', age_band: 'adult' },
  }), created, db);
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.display_name, 'Dad');
  assert.equal(created.body.is_primary, false);
  assert.equal(created.body.is_active, false);
  const dadId = created.body.profile_id;
  assert.ok(dadId);

  const before = fakeRes();
  await handleProfile(authedReq(tenantId), before, db);
  assert.equal(before.body.display_name, 'Kid'); // active is still the primary

  const switched = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/active', body: { profile_id: dadId },
  }), switched, db);
  // No PIN exists on this account, and leaving a band-protected
  // profile with no lock armed carries the plain warning (the OFF
  // half's honesty), but the switch itself is allowed.
  assert.equal(switched.statusCode, 200);
  assert.equal(switched.body.profile_id, dadId);
  assert.equal(switched.body.is_active, true);
  assert.equal(switched.body.warning, 'no_parent_pin_set');

  const after = fakeRes();
  await handleProfile(authedReq(tenantId), after, db);
  assert.equal(after.body.display_name, 'Dad');
  assert.equal(after.body.profile_id, dadId);
});

test('bite 9 handler: POST /active with a foreign profile_id is a 404 and moves nothing; a missing one is a 400', async () => {
  const db = new FakeDb();
  const { tenantId, primary } = await makeHousehold(db);
  const other = await makeAccount(db);
  const otherProfile = await getProfile(db, other);

  const foreign = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/active',
    body: { profile_id: otherProfile.profile_id },
  }), foreign, db);
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(foreign.body, { error: 'profile_not_found' });
  assert.equal((await getProfile(db, tenantId)).profile_id, primary.profile_id);

  const missing = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/active', body: {},
  }), missing, db);
  assert.equal(missing.statusCode, 400);
  assert.deepEqual(missing.body, { error: 'profile_id_required' });
});

test('bite 9 handler: PUT with profile_id edits only the named profile; a foreign id writes nothing', async () => {
  const db = new FakeDb();
  const { tenantId, primary, second } = await makeHousehold(db);

  const res = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { profile_id: second.profile_id, about_me: 'Bounces ideas' },
  }), res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.about_me, 'Bounces ideas');
  assert.equal(res.body.profile_id, second.profile_id);
  assert.equal((await getProfileById(db, tenantId, primary.profile_id)).about_me, null);

  const other = await makeAccount(db);
  const otherProfile = await getProfile(db, other);
  const foreign = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { profile_id: otherProfile.profile_id, about_me: 'Hacked' },
  }), foreign, db);
  assert.equal(foreign.statusCode, 404);
  assert.deepEqual(foreign.body, { error: 'profile_not_found' });
  assert.equal((await getProfile(db, other)).about_me, null);
});

test('bite 9 handler: bite 8 holds per profile — arming a child profile takes a PIN, and the lock it sets is the account\'s', async () => {
  const db = new FakeDb();
  const { tenantId, primary, second } = await makeHousehold(db);

  const refused = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { profile_id: second.profile_id, safety_mode: true },
  }), refused, db);
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(refused.body, { error: 'parent_pin_required' });
  assert.equal((await getProfileById(db, tenantId, second.profile_id)).safety_mode, false);

  const armed = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { profile_id: second.profile_id, safety_mode: true, pin: '2468' },
  }), armed, db);
  assert.equal(armed.statusCode, 200);
  assert.equal(armed.body.safety_mode, true);
  assert.equal(armed.body.pin_set, true);
  // The PIN landed on the ACCOUNT (primary row), not on the child.
  assert.ok((await getProfileById(db, tenantId, primary.profile_id)).parent_pin_hash);
  assert.equal((await getProfileById(db, tenantId, second.profile_id)).parent_pin_hash, null);

  // And that same account PIN now gates safety OFF on the primary.
  const onPrimary = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { safety_mode: true },
  }), onPrimary, db);
  assert.equal(onPrimary.statusCode, 200); // PIN on file satisfies the ON half
  const wrong = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { safety_mode: false, pin: '0000' },
  }), wrong, db);
  assert.equal(wrong.statusCode, 403);
  assert.deepEqual(wrong.body, { error: 'invalid_parent_pin' });
  const right = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { safety_mode: false, pin: '2468' },
  }), right, db);
  assert.equal(right.statusCode, 200);
  assert.equal(right.body.safety_mode, false);
});

test('bite 9 handler: safety OFF on a child profile is gated by the account PIN — the child row\'s empty hash is not a bypass', async () => {
  const db = new FakeDb();
  const { tenantId, second } = await makeHousehold(db);
  await upsertProfile(db, tenantId, { safety_mode: true }, second.profile_id); // armed at the lib layer
  await setParentPin(db, tenantId, '2468');

  const noPin = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { profile_id: second.profile_id, safety_mode: false },
  }), noPin, db);
  assert.equal(noPin.statusCode, 403);
  assert.deepEqual(noPin.body, { error: 'parent_pin_required' }); // NOT the no-PIN warning path
  assert.equal((await getProfileById(db, tenantId, second.profile_id)).safety_mode, true);

  const withPin = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT', body: { profile_id: second.profile_id, safety_mode: false, pin: '2468' },
  }), withPin, db);
  assert.equal(withPin.statusCode, 200);
  assert.equal(withPin.body.safety_mode, false);
});

test('bite 9 handler: creating a profile with safety ON and no account PIN is refused; with a pin it is created armed', async () => {
  const db = new FakeDb();
  const tenantId = await makeAccount(db);

  const refused = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/profiles',
    body: { display_name: 'Kid', age_band: '6-8', safety_mode: true },
  }), refused, db);
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(refused.body, { error: 'parent_pin_required' });
  assert.equal((await listProfiles(db, tenantId)).length, 1); // nothing created

  const created = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/profiles',
    body: { display_name: 'Kid', age_band: '6-8', safety_mode: true, pin: '2468' },
  }), created, db);
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.safety_mode, true);
  assert.equal(created.body.pin_set, true);
  assert.equal(await hasParentPin(db, tenantId), true);
});

test('bite 9 handler: switching away from a protected profile takes the account PIN; switching toward protection does not', async () => {
  const db = new FakeDb();
  const { tenantId, primary, second } = await makeHousehold(db); // primary: 6-8 band (protected), second: adult
  await setParentPin(db, tenantId, '2468');

  const noPin = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/active', body: { profile_id: second.profile_id },
  }), noPin, db);
  assert.equal(noPin.statusCode, 403);
  assert.deepEqual(noPin.body, { error: 'parent_pin_required' });
  assert.equal((await getProfile(db, tenantId)).profile_id, primary.profile_id); // still the kid

  const wrongPin = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/active',
    body: { profile_id: second.profile_id, pin: '0000' },
  }), wrongPin, db);
  assert.equal(wrongPin.statusCode, 403);
  assert.deepEqual(wrongPin.body, { error: 'invalid_parent_pin' });

  const rightPin = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/active',
    body: { profile_id: second.profile_id, pin: '2468' },
  }), rightPin, db);
  assert.equal(rightPin.statusCode, 200);
  assert.equal(rightPin.body.profile_id, second.profile_id);

  const backAgain = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/active', body: { profile_id: primary.profile_id },
  }), backAgain, db);
  assert.equal(backAgain.statusCode, 200); // toward protection: no PIN asked
  assert.equal(backAgain.body.profile_id, primary.profile_id);
});

test('bite 9 handler: profile creation past the household limit is a named 400', async () => {
  const db = new FakeDb();
  const tenantId = await makeAccount(db);
  for (let i = 0; i < PROFILES_PER_TENANT_LIMIT - 1; i++) {
    const res = fakeRes();
    await handleProfile(authedReq(tenantId, {
      method: 'POST', url: 'http://local/api/profile/profiles',
      body: { display_name: `P${i}`, age_band: 'adult' },
    }), res, db);
    assert.equal(res.statusCode, 200);
  }
  const over = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/profiles',
    body: { display_name: 'One too many', age_band: 'adult' },
  }), over, db);
  assert.equal(over.statusCode, 400);
  assert.deepEqual(over.body, { error: 'profile_limit_reached' });
});

// ─── Prime level: the voice prompt follows the active profile ───────

test('bite 9 prime: the primed prompt follows the active profile across switches — kid core on, off, on', () => {
  const child = fileURLToPath(new URL('./fixtures/profiles-multi-prime-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  const out = JSON.parse(line);

  assert.equal(out.switch1.code, 200, 'switch to the adult profile succeeds');
  assert.equal(out.switch2.code, 200, 'switch back to the kid profile succeeds');

  assert.equal(out.prime1.code, 200);
  assert.equal(out.prime1.kidCore, true, 'minor profile active -> kid core in the primed prompt');
  assert.equal(out.prime1.baseRules, true);

  assert.equal(out.prime2.code, 200);
  assert.equal(out.prime2.kidCore, false, 'adult profile active -> no kid core; the sibling minor never leaks in');
  assert.equal(out.prime2.baseRules, true);

  assert.equal(out.prime3.code, 200);
  assert.equal(out.prime3.kidCore, true, 'switching back re-primes under the minor profile');
});
