// test/profile.test.mjs — accounts bite: tenant profiles, the parent
// PIN rule, and the profile -> safety wiring decision. Fake db, no live
// database. The profileSafety tests pin the EXACT helper the paid
// handlers (chat/speak/image/video) call in hosted mode, so the
// production path is what is verified here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AGE_BANDS, getProfile, upsertProfile, setParentPin, verifyParentPin, profileSafety,
  resolveProfileSafety,
} from '../lib/profile.js';
import { createAccount } from '../lib/accounts.js';
import { signSession } from '../lib/tenant.js';
import { handleProfile } from '../server/handlers/profile.js';
import { FakeDb } from './fake-db.mjs';

const SECRET = 'profile-test-secret';
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

async function accountWithProfile(db, fields = {}) {
  const { tenantId } = await createAccount(db, {
    email: `u${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'a long passphrase',
  });
  if (Object.keys(fields).length) await upsertProfile(db, tenantId, fields);
  return tenantId;
}

// ─── getProfile / upsertProfile ───────────────────────────────────────────

test('getProfile returns null for an unknown tenant', async () => {
  const db = new FakeDb();
  assert.equal(await getProfile(db, '00000000-0000-4000-8000-000000000099'), null);
});

test('upsertProfile creates, then updates, whitelisted fields', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db);
  const created = await upsertProfile(db, tenantId, { display_name: 'Sam', age_band: '9-12', about_me: 'Loves frogs' });
  assert.equal(created.display_name, 'Sam');
  assert.equal(created.age_band, '9-12');
  const updated = await upsertProfile(db, tenantId, { display_name: 'Samuel' });
  assert.equal(updated.display_name, 'Samuel');
  assert.equal(updated.age_band, '9-12'); // untouched fields survive
});

test('upsertProfile IGNORES credential fields — parent_pin_hash/password cannot be written through it', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db);
  const row = await upsertProfile(db, tenantId, {
    display_name: 'Sam',
    parent_pin_hash: 'attacker-controlled',
    password_hash: 'attacker-controlled',
    tenant_id: 'someone-else',
  });
  assert.equal(row.display_name, 'Sam');
  assert.equal(row.parent_pin_hash, null);
  assert.equal(row.tenant_id, tenantId);
});

test('upsertProfile validates age_band against AGE_BANDS', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db);
  for (const band of AGE_BANDS) {
    const row = await upsertProfile(db, tenantId, { age_band: band });
    assert.equal(row.age_band, band);
  }
  await assert.rejects(
    upsertProfile(db, tenantId, { age_band: 'toddler' }),
    (e) => e.code === 'invalid_age_band',
  );
});

// ─── Parent PIN ───────────────────────────────────────────────────────────

test('setParentPin/verifyParentPin: correct PIN passes, wrong fails, unset fails closed', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db);
  assert.equal(await verifyParentPin(db, tenantId, '2468'), false); // no PIN set yet
  await setParentPin(db, tenantId, '2468');
  assert.equal(await verifyParentPin(db, tenantId, '2468'), true);
  assert.equal(await verifyParentPin(db, tenantId, '0000'), false);
  const stored = await getProfile(db, tenantId);
  assert.ok(stored.parent_pin_hash);
  assert.ok(!stored.parent_pin_hash.includes('2468')); // hash, never the PIN
});

test('setParentPin rejects a too-short PIN', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db);
  await assert.rejects(setParentPin(db, tenantId, '12'), (e) => e.code === 'invalid_pin');
});

// ─── profileSafety — the wiring decision the handlers call ────────────────

test('profileSafety: a minor profile yields failClosed + kidCore (the production wiring path)', () => {
  for (const band of ['child', '6-8', '9-12']) {
    assert.deepEqual(
      profileSafety({ safety_mode: false, age_band: band }),
      { failClosed: true, kidCore: true },
      `band ${band} must fail closed`,
    );
  }
});

test('profileSafety: adult without safety mode is neutral; safety mode on is fail-closed; null profile is neutral', () => {
  assert.deepEqual(profileSafety({ safety_mode: false, age_band: 'adult' }), { failClosed: false, kidCore: false });
  assert.deepEqual(profileSafety({ safety_mode: false, age_band: '13-17' }), { failClosed: false, kidCore: false });
  assert.deepEqual(profileSafety({ safety_mode: true, age_band: 'adult' }), { failClosed: true, kidCore: true });
  assert.deepEqual(profileSafety(null), { failClosed: false, kidCore: false });
});

// ─── /api/profile handler ─────────────────────────────────────────────────

test('GET /api/profile returns the whitelisted profile + plan, never the PIN hash', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { display_name: 'Sam', age_band: '6-8', safety_mode: true });
  await setParentPin(db, tenantId, '2468');
  const res = fakeRes();
  await handleProfile(authedReq(tenantId), res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.display_name, 'Sam');
  assert.equal(res.body.age_band, '6-8');
  assert.equal(res.body.safety_mode, true);
  assert.equal(res.body.pin_set, true);
  assert.equal(res.body.plan, 'free');
  assert.ok(!('parent_pin_hash' in res.body));
  const stored = await getProfile(db, tenantId);
  assert.ok(!JSON.stringify(res.body).includes(stored.parent_pin_hash));
});

test('PUT /api/profile writes whitelisted fields only (parent_pin_hash in the body is ignored)', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db);
  const res = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT',
    body: { display_name: 'Jo', parent_pin_hash: 'attacker-controlled', password: 'x' },
  }), res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.display_name, 'Jo');
  assert.equal(res.body.pin_set, false);
  assert.equal((await getProfile(db, tenantId)).parent_pin_hash, null);
});

test("Troy's rule: safety OFF with a PIN set is refused without the PIN, refused with a wrong PIN, allowed with the right one", async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { safety_mode: true });
  await setParentPin(db, tenantId, '2468');

  const noPin = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { safety_mode: false } }), noPin, db);
  assert.equal(noPin.statusCode, 403);
  assert.deepEqual(noPin.body, { error: 'parent_pin_required' });
  assert.equal((await getProfile(db, tenantId)).safety_mode, true); // unchanged

  const wrongPin = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { safety_mode: false, pin: '0000' } }), wrongPin, db);
  assert.equal(wrongPin.statusCode, 403);
  assert.deepEqual(wrongPin.body, { error: 'invalid_parent_pin' });
  assert.equal((await getProfile(db, tenantId)).safety_mode, true);

  const rightPin = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { safety_mode: false, pin: '2468' } }), rightPin, db);
  assert.equal(rightPin.statusCode, 200);
  assert.equal(rightPin.body.safety_mode, false);
  assert.equal((await getProfile(db, tenantId)).safety_mode, false);
});

test('safety OFF with NO PIN set is allowed but the response warns pinSet:false', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { safety_mode: true });
  const res = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { safety_mode: false } }), res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.safety_mode, false);
  assert.equal(res.body.pinSet, false);
  assert.equal(res.body.warning, 'no_parent_pin_set');
});

// ─── Bite 8: safety ON must be PIN-locked ─────────────────────────────────
//
// "Safety mode is on" and "a parent PIN protects it" are the same
// state. The rule lives in the handler, beside the safety-OFF half:
// PUT safety_mode:true while no PIN hash exists requires { pin } in
// the SAME request, and the hash is set as part of that operation —
// so a hand-rolled API caller gets exactly the rule the UI shows.
// Refusal shape is the handler's own dialect: 403
// { error: 'parent_pin_required' } when the PIN is absent (the same
// named error the OFF half uses for its absent PIN), 400
// { error: 'invalid_pin' } when the supplied PIN fails the library's
// policy (the /pin route's mapping) — no new error names.

test('Bite 8: safety ON with no PIN on file and no pin in the request is refused — safety_mode and every other field unchanged', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { display_name: 'Sam', age_band: 'adult', about_me: 'before' });
  const res = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT',
    body: { safety_mode: true, about_me: 'must not stick' },
  }), res, db);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'parent_pin_required' });
  const stored = await getProfile(db, tenantId);
  assert.equal(stored.safety_mode, false); // unchanged
  assert.equal(stored.about_me, 'before'); // the refusal writes NOTHING
  assert.equal(stored.parent_pin_hash, null);
});

test('Bite 8: safety ON with a pin in the same request arms both — profile saved, pin_set true, PIN verifies', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { display_name: 'Sam', age_band: 'adult' });
  const res = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT',
    body: { safety_mode: true, pin: '2468' },
  }), res, db);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.safety_mode, true);
  assert.equal(res.body.pin_set, true);
  const stored = await getProfile(db, tenantId);
  assert.equal(stored.safety_mode, true);
  assert.ok(stored.parent_pin_hash);
  assert.ok(!JSON.stringify(res.body).includes(stored.parent_pin_hash)); // hash never leaves
  assert.equal(await verifyParentPin(db, tenantId, '2468'), true);
});

test('Bite 8: safety ON with an invalid pin in the request is refused 400 invalid_pin — zero writes', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { display_name: 'Sam', age_band: 'adult' });
  const res = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'PUT',
    body: { safety_mode: true, display_name: 'must not stick', pin: '12' },
  }), res, db);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'invalid_pin' });
  const stored = await getProfile(db, tenantId);
  assert.equal(stored.safety_mode, false);
  assert.equal(stored.display_name, 'Sam');
  assert.equal(stored.parent_pin_hash, null);
});

test('Bite 8: safety ON with a PIN already on file needs no new PIN — and a stray pin in the body does NOT replace the stored one', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { age_band: 'adult' });
  await setParentPin(db, tenantId, '2468');

  const plain = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { safety_mode: true } }), plain, db);
  assert.equal(plain.statusCode, 200);
  assert.equal(plain.body.safety_mode, true);
  assert.equal(plain.body.pin_set, true);

  // Turn back off with the real PIN, then on again with a stray one:
  // the write is allowed (a PIN exists) but the stray pin is ignored —
  // replacing a PIN stays the /pin route's job.
  const off = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { safety_mode: false, pin: '2468' } }), off, db);
  assert.equal(off.statusCode, 200);
  const stray = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { safety_mode: true, pin: '9999' } }), stray, db);
  assert.equal(stray.statusCode, 200);
  assert.equal(stray.body.safety_mode, true);
  assert.equal(await verifyParentPin(db, tenantId, '2468'), true);
  assert.equal(await verifyParentPin(db, tenantId, '9999'), false);
});

test('Bite 8: the line holds the other way — safety OFF without a PIN stays allowed, and writes that never mention safety_mode are untouched by the rule', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { display_name: 'Sam', age_band: 'adult' });

  const noSafetyField = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { about_me: 'Loves frogs' } }), noSafetyField, db);
  assert.equal(noSafetyField.statusCode, 200);
  assert.equal(noSafetyField.body.about_me, 'Loves frogs');
  assert.equal(noSafetyField.body.pin_set, false);

  const offWhileOff = fakeRes();
  await handleProfile(authedReq(tenantId, { method: 'PUT', body: { safety_mode: false } }), offWhileOff, db);
  assert.equal(offWhileOff.statusCode, 200);
  assert.equal(offWhileOff.body.safety_mode, false);
  assert.equal(offWhileOff.body.warning, undefined); // no friction, no warning theatre
});

test('POST /api/profile/pin sets the PIN; /pin/verify checks it', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db);
  const set = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/pin', body: { pin: '1357' },
  }), set, db);
  assert.equal(set.statusCode, 200);
  assert.deepEqual(set.body, { ok: true, pinSet: true });

  const good = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/pin/verify', body: { pin: '1357' },
  }), good, db);
  assert.deepEqual(good.body, { ok: true });

  const bad = fakeRes();
  await handleProfile(authedReq(tenantId, {
    method: 'POST', url: 'http://local/api/profile/pin/verify', body: { pin: '9999' },
  }), bad, db);
  assert.deepEqual(bad.body, { ok: false });
});

// ─── resolveProfileSafety — the shared resolver (safety wiring bite 1) ────
//
// The matrix the four profile-aware handlers (chat/speak/image/video)
// now share: a profile WITH an age band decides; anything else — no
// row, an unfinished (age-band-less) row, or a store that throws —
// resolves to the SAFE DEFAULT (safety applies), never to neutral and
// never to request-claimed safety (the resolver takes no request
// inputs at all, so there is nothing for a request to weaken with).

test('resolveProfileSafety: a minor profile decides (failClosed + kidCore, prompt inputs from the profile)', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { age_band: '6-8', safety_mode: false });
  const r = await resolveProfileSafety(db, tenantId);
  assert.equal(r.source, 'profile');
  assert.equal(r.safeDefault, false);
  assert.deepEqual(r.decision, { failClosed: true, kidCore: true });
  assert.deepEqual(r.inputs, { safetyMode: false, ageBand: '6-8' });
});

test('resolveProfileSafety: safety-on adult decides fail-closed; adult and 13-17 with safety off decide neutral', async () => {
  const db = new FakeDb();
  const onAdult = await accountWithProfile(db, { age_band: 'adult', safety_mode: true });
  const rOn = await resolveProfileSafety(db, onAdult);
  assert.equal(rOn.source, 'profile');
  assert.deepEqual(rOn.decision, { failClosed: true, kidCore: true });
  assert.deepEqual(rOn.inputs, { safetyMode: true, ageBand: 'adult' });

  const adult = await accountWithProfile(db, { age_band: 'adult', safety_mode: false });
  const rAdult = await resolveProfileSafety(db, adult);
  assert.equal(rAdult.source, 'profile');
  assert.equal(rAdult.safeDefault, false);
  assert.deepEqual(rAdult.decision, { failClosed: false, kidCore: false });
  assert.deepEqual(rAdult.inputs, { safetyMode: false, ageBand: 'adult' });

  // 13-17 is NOT a minor band under the documented under-13 rule
  // (lib/safety.js) — the profile still decides; it decides neutral.
  const teen = await accountWithProfile(db, { age_band: '13-17', safety_mode: false });
  const rTeen = await resolveProfileSafety(db, teen);
  assert.equal(rTeen.source, 'profile');
  assert.deepEqual(rTeen.decision, { failClosed: false, kidCore: false });
});

test('resolveProfileSafety: no profile row -> safe default (safety applies), never neutral', async () => {
  const db = new FakeDb();
  const r = await resolveProfileSafety(db, '00000000-0000-4000-8000-000000000099');
  assert.equal(r.source, 'no-profile');
  assert.equal(r.safeDefault, true);
  assert.equal(r.profile, null);
  assert.deepEqual(r.decision, { failClosed: true, kidCore: true });
  assert.deepEqual(r.inputs, { safetyMode: true, ageBand: null });
});

test('resolveProfileSafety: an unfinished profile (row exists, age_band null) -> safe default until onboarding completes', async () => {
  const db = new FakeDb();
  // createAccount leaves the empty signup row: age_band null,
  // safety_mode false. Before bite 1 the handlers treated that row
  // as a profile decision (neutral); now it cannot decide.
  const tenantId = await accountWithProfile(db);
  const r = await resolveProfileSafety(db, tenantId);
  assert.equal(r.source, 'incomplete-profile');
  assert.equal(r.safeDefault, true);
  assert.deepEqual(r.decision, { failClosed: true, kidCore: true });
  assert.deepEqual(r.inputs, { safetyMode: true, ageBand: null });

  // Even with safety_mode somehow set, a band-less row does not
  // "decide" — the safe default carries it (same decision, honest
  // source).
  const tenant2 = await accountWithProfile(db, { safety_mode: true });
  const r2 = await resolveProfileSafety(db, tenant2);
  assert.equal(r2.source, 'incomplete-profile');
  assert.deepEqual(r2.decision, { failClosed: true, kidCore: true });
});

test('resolveProfileSafety: a throwing profile store resolves to the safe default — it never rejects, never downgrades', async () => {
  const throwingDb = {
    query: async () => { throw new Error('profile store down'); },
  };
  const r = await resolveProfileSafety(throwingDb, '00000000-0000-4000-8000-000000000001');
  assert.equal(r.source, 'load-error');
  assert.equal(r.safeDefault, true);
  assert.deepEqual(r.decision, { failClosed: true, kidCore: true });
  assert.deepEqual(r.inputs, { safetyMode: true, ageBand: null });
});

test('resolveProfileSafety: accepts the factory form of db (handlers pass getProfileDb itself)', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db, { age_band: '9-12' });
  const r = await resolveProfileSafety(async () => db, tenantId);
  assert.equal(r.source, 'profile');
  assert.deepEqual(r.decision, { failClosed: true, kidCore: true });
});

test('profile handler: no session token -> 401; compat mode -> 503', async () => {
  const db = new FakeDb();
  const tenantId = await accountWithProfile(db);
  const anon = fakeRes();
  // requireTenant writes via status().json() or writeHead/end — give the fake both.
  anon.writeHead = function (c) { this.statusCode = c; return this; };
  anon.end = function (s) { this.body = JSON.parse(s); return this; };
  await handleProfile({ method: 'GET', url: 'http://local/api/profile', headers: {}, body: {} }, anon, db);
  assert.equal(anon.statusCode, 401);

  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    const compat = fakeRes();
    await handleProfile(authedReq(tenantId), compat, db);
    assert.equal(compat.statusCode, 503);
    assert.deepEqual(compat.body, { error: 'accounts_not_configured' });
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});
