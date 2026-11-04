// test/profiles-client.test.mjs — safety bite 9b: the client half
// of multi-profile (safety-gap-map §7 bite 9), plus the
// deterministic-ordering fix play-prep pass 1 named.
//
// Bite 9 landed the foundation: profiles are a collection under
// the tenant, the server targets the ACTIVE profile, and the
// resolver decides from it. This bite's client half:
//
//   - the Settings pane lists the household, switches the active
//     profile (with the server PIN gate's client face), creates
//     profiles up to the household limit, and edits any profile's
//     name / band / about / safety (bite 8's rule intact);
//   - a successful switch publishes tb-profile-changed (bite 5's
//     contract — the pinned publish count in
//     test/profile-reprime.test.mjs moved 5 -> 8 with this bite's
//     switch/create/edit-save sites), and the active profile's id
//     joins the prime request and the widget's dynamic variables.
//
// Method, the house client pattern: the ordering regression runs
// the real lib + handler against the FakeDb; the priming behavior
// runs index.html's prime block under node:vm with a fake
// /api/prime-agent at the fetch seam (the lifecycle harness of
// test/profile-reprime.test.mjs, extended with the
// window.tbActiveProfileId getter onboarding.js maintains); the
// pane wiring itself is pinned statically, as bites 5 and 8 pin
// theirs — there is no browser run in this bite.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import {
  getProfile, listProfiles, createProfile, upsertProfile,
} from '../lib/profile.js';
import { createAccount } from '../lib/accounts.js';
import { signSession } from '../lib/tenant.js';
import { handleProfile } from '../server/handlers/profile.js';
import { FakeDb } from './fake-db.mjs';

const SECRET = 'profiles-client-test-secret';
process.env.SESSION_SECRET = SECRET;

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const onboardingJs = readFileSync(new URL('../public/onboarding.js', import.meta.url), 'utf8');
const profileLib = readFileSync(new URL('../lib/profile.js', import.meta.url), 'utf8');

function sliceExclusive(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after: ${startMarker}`);
  return src.slice(a, b);
}

// ─── Ordering: deterministic, primary first ─────────────────────

test('ordering: listProfiles SQL leads with is_primary DESC, created_at and profile_id as tiebreaks', () => {
  const listFn = sliceExclusive(profileLib, 'export async function listProfiles', 'export async function hasParentPin');
  assert.ok(listFn.includes('ORDER BY is_primary DESC, created_at ASC, profile_id ASC'));
});

test('ordering: two profiles created in the same millisecond list in the same stable order across repeated calls', async () => {
  const db = new FakeDb();
  const { tenantId } = await createAccount(db, {
    email: 'order@example.com', password: 'a long passphrase',
  });
  await upsertProfile(db, tenantId, { display_name: 'Kid', age_band: '6-8' });
  const second = await createProfile(db, tenantId, { display_name: 'Dad', age_band: 'adult' });
  const third = await createProfile(db, tenantId, { display_name: 'Teen', age_band: '13-17' });
  const primary = await getProfile(db, tenantId);

  // Force the exact condition that flaked play-prep pass 1: every
  // row stamped in the SAME millisecond, so created_at ties across
  // the whole household. (The FakeDb stamps new Date() at insert;
  // back-to-back inserts tie on their own about half the time —
  // pinning the timestamp makes the regression deterministic.)
  const sameMs = new Date();
  for (const row of db.profileRows) row.created_at = sameMs;

  const expectedTail = [second.profile_id, third.profile_id].sort((a, b) => a.localeCompare(b));
  const expected = [primary.profile_id, ...expectedTail];
  for (let i = 0; i < 5; i += 1) {
    const list = await listProfiles(db, tenantId);
    assert.deepEqual(list.map((p) => p.profile_id), expected, `call ${i + 1} lists the same stable order`);
    assert.equal(list[0].is_primary, true, 'the primary leads every listing');
  }

  // And the handler serves the same order to the client.
  const res = {
    statusCode: null, body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
  await handleProfile({
    method: 'GET',
    url: 'http://local/api/profile/profiles',
    headers: { authorization: `Bearer ${signSession(tenantId, SECRET)}` },
    body: {},
  }, res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.profiles.map((p) => p.profile_id), expected);
});

// ─── Priming: the active profile id rides the prime request ─────

function makePrimeHarness({ withGetter = true } = {}) {
  let currentProfileId = 'prof-2';
  const primeCalls = [];
  const fetch = (url, opts) => {
    primeCalls.push({ url, opts });
    return Promise.resolve({
      json: async () => ({ ok: true, prompt: 'PROMPT', memoryCount: 0, buddyName: 'B', userId: 'u1' }),
    });
  };
  const listeners = {};
  const windowObj = { addEventListener: (name, fn) => { listeners[name] = fn; } };
  if (withGetter) windowObj.tbActiveProfileId = () => currentProfileId;
  const sandbox = {
    console,
    fetch,
    tbAuthHeaders: () => ({ Authorization: 'Bearer tok-abc' }),
    window: windowObj,
  };
  vm.createContext(sandbox);
  const lifecycleSrc = sliceExclusive(indexHtml, 'let sessionPromptOverride = null;', 'function fireExtractMemories');
  vm.runInContext(lifecycleSrc, sandbox);
  const run = (expr) => vm.runInContext(expr, sandbox);
  run(`sessionPrimeContext = { buddyName: 'B', userName: 'U', userId: 'u1', mode: 'default' };`);
  return {
    primeCalls, listeners, run,
    setProfileId(id) { currentProfileId = id; },
  };
}

test('priming: the prime request carries the active profile id, and a switch re-primes under the new one', async () => {
  const h = makePrimeHarness();
  await h.run('primeSessionPrompt()');
  assert.equal(h.primeCalls.length, 1);
  const first = JSON.parse(h.primeCalls[0].opts.body);
  assert.equal(first.profileId, 'prof-2');
  assert.equal(first.userId, 'u1', 'the session-identity fields ride unchanged');
  assert.equal(first.buddyName, 'B');

  // The parent switches profiles in Settings; the switch publishes
  // tb-profile-changed and the re-prime names the NEW active id.
  h.setProfileId('prof-3');
  h.listeners['tb-profile-changed']();
  await h.run('reprimeSessionPrompt()');
  assert.equal(h.primeCalls.length, 2);
  assert.equal(JSON.parse(h.primeCalls[1].opts.body).profileId, 'prof-3');
});

test('priming: with no profile known, the prime request is byte-for-byte the pre-profile shape', async () => {
  const h = makePrimeHarness({ withGetter: false });
  await h.run('primeSessionPrompt()');
  const body = JSON.parse(h.primeCalls[0].opts.body);
  assert.ok(!('profileId' in body), 'no profileId key is sent when no profile is known');
  assert.deepEqual(body, { buddyName: 'B', userName: 'U', userId: 'u1', mode: 'default' });
});

test('priming: index.html wires the id from the getter into both the prime request and the widget variables', () => {
  const primeFn = sliceExclusive(indexHtml, 'async function primeSessionPrompt()', 'function currentSessionPrompt');
  assert.ok(primeFn.includes('profileId: primeProfileId'), 'the prime body carries profileId');
  const callHandler = sliceExclusive(indexHtml, "document.addEventListener('elevenlabs-convai:call'", 'const userOnConnect = cfg.onConnect;');
  assert.ok(callHandler.includes('profile_id: pid'), 'the widget dynamic variables carry profile_id beside user_id');
  assert.ok(onboardingJs.includes('window.tbActiveProfileId'), 'onboarding.js maintains the getter index.html reads');
});

// ─── The pane: ids, endpoints, and the switch/create/edit wiring ─

const PROFILE_PANE_IDS = [
  'accountProfilesList', 'accountProfilesLine',
  'accountSwitchPinRow', 'accountSwitchPin', 'accountSwitchPinConfirm', 'accountSwitchPinCancel',
  'accountProfileEdit', 'accountProfileEditName', 'accountProfileEditBand', 'accountProfileEditAbout',
  'accountProfileEditSafety', 'accountProfileEditPinRow', 'accountProfileEditPinLabel',
  'accountProfileEditPin', 'accountProfileEditPinAgainWrap', 'accountProfileEditPinAgain',
  'accountProfileEditSave', 'accountProfileEditCancel', 'accountProfileEditLine',
  'accountProfileNewName', 'accountProfileNewBand', 'accountProfileNewSafety',
  'accountProfileNewPinRow', 'accountProfileNewPin', 'accountProfileNewPinAgain',
  'accountProfileCreateBtn', 'accountProfileCreateLine',
];

test('pane: every bite-9b element id appears exactly once in index.html', () => {
  for (const id of PROFILE_PANE_IDS) {
    const count = indexHtml.split(`id="${id}"`).length - 1;
    assert.equal(count, 1, `id "${id}" should appear exactly once, found ${count}`);
  }
});

test('pane: the create form takes an explicit age band — a value-less placeholder, nothing preselected', () => {
  const bandSelect = sliceExclusive(indexHtml, 'id="accountProfileNewBand"', '</select>');
  assert.ok(bandSelect.includes('<option value="" selected>Choose…</option>'));
});

test('pane: onboarding.js talks to the bite-9 profile endpoints', () => {
  assert.ok(onboardingJs.includes("api('/api/profile/profiles')"), 'the list load');
  assert.ok(onboardingJs.includes("api('/api/profile/profiles', { method: 'POST', body })"), 'the create');
  assert.ok(onboardingJs.includes("api('/api/profile/active', { method: 'POST', body })"), 'the switch');
});

test('switch: a success publishes and re-reads; the PIN gate and the no-PIN warning have their client faces', () => {
  const switchFn = sliceExclusive(onboardingJs, 'async function switchActiveProfile', "document.getElementById('accountProfilesList')");
  // Success: publish (the re-prime must follow the new active
  // profile) and surface the server's no-lock warning verbatim-ish.
  assert.ok(switchFn.includes('publishProfileChanged();'));
  assert.ok(switchFn.includes("res.data?.warning === 'no_parent_pin_set'"));
  assert.ok(switchFn.includes('anyone with this phone can switch profiles'));
  // The gate: parent_pin_required parks the target and opens the
  // PIN row; the retry sends the PIN (the confirm handler below).
  assert.ok(switchFn.includes("res.data?.error === 'parent_pin_required'"));
  assert.ok(switchFn.includes("res.data?.error === 'invalid_parent_pin'"));
  assert.ok(switchFn.includes('pendingSwitchId = profileId'));
  const confirm = sliceExclusive(onboardingJs, "getElementById('accountSwitchPinConfirm')", "getElementById('accountSwitchPinCancel')");
  assert.ok(confirm.includes('switchActiveProfile(pendingSwitchId, pin)'), 'confirm retries the switch with the PIN');
});

test('create: the household limit refusal gets a plain message, and safety-on follows bite 8', () => {
  const createBlock = sliceExclusive(onboardingJs, "getElementById('accountProfileCreateBtn')", '// Edit: any profile in the household');
  assert.ok(createBlock.includes("res.data?.error === 'profile_limit_reached'"));
  assert.ok(createBlock.includes('This account already has the most profiles it can hold (4).'));
  // Safety checked with no account PIN: the new PIN + confirmation
  // are required before the create is even sent, and ride the body.
  assert.ok(createBlock.includes('if (safety && !profileCache?.pin_set)'));
  assert.ok(createBlock.includes('body.pin = pin'));
  assert.ok(createBlock.includes('if (pin !== pinAgain)'));
  assert.ok(createBlock.includes('publishProfileChanged();'), 'a successful create publishes');
});

test('edit: the save targets the profile by id and mirrors both PIN halves before the write', () => {
  const saveBlock = sliceExclusive(onboardingJs, "getElementById('accountProfileEditSave')", "getElementById('accountProfileEditCancel')");
  assert.ok(saveBlock.includes('profile_id: editProfileId'), 'the PUT names its target profile');
  assert.ok(saveBlock.includes("api('/api/profile', { method: 'PUT', body })"));
  // Arming safety on a PIN-less account: create-a-PIN branch.
  assert.ok(saveBlock.includes('if (safety && !target.safety_mode && !profileCache?.pin_set)'));
  // Disarming it under an armed lock: current-PIN branch.
  assert.ok(saveBlock.includes('else if (!safety && target.safety_mode && profileCache?.pin_set)'));
  // The server's refusals land on named lines, never silently.
  assert.ok(saveBlock.includes("res.data?.error === 'parent_pin_required'"));
  assert.ok(saveBlock.includes("res.data?.error === 'invalid_parent_pin'"));
  assert.ok(saveBlock.includes("res.data?.warning === 'no_parent_pin_set'"));
  assert.ok(saveBlock.includes('publishProfileChanged();'), 'a successful edit publishes');
});
