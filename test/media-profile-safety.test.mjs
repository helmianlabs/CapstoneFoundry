// test/media-profile-safety.test.mjs — safety wiring bite 3
// (safety-gap-map §7): handler-level pins for the four request-only
// generation handlers (image-flux, video-runway, video-runway-veo,
// video-heygen) now taking their moderation fail-closed state from
// the tenant profile through Bite 1's shared resolver.
//
// Pinned here: a minor profile refuses all four handlers when
// moderation is unavailable (provider never called); a request body
// claiming safetyMode:false / ageBand:'adult' cannot weaken that
// profile; a throwing profile store lands on the resolver's safe
// default, not on request inputs; an adult profile with clean
// moderation lets the provider path proceed to a completed
// generation; and compat mode is untouched (request safety decides,
// zero profile queries).
//
// The handlers run in a child process with module mocks — see
// test/fixtures/media-profile-safety-child.mjs. The child runs ONCE
// for the whole file (its runway/veo/heygen success flows poll on
// real timers). NOT covered: any live deployment or live provider
// (the child stubs fetch at the boundary and counts calls, and
// fakes the blob write).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/media-profile-safety-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    // The runway/veo/heygen success flows poll on real timers
    // (5s/4s/6s) and two scenario blocks run them end to end.
    timeout: 180_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  return JSON.parse(line);
}

const results = runChild();
const HANDLERS = ['flux', 'runway', 'veo', 'heygen'];

test('handler pins (bite 3): minor profile + moderation down -> all four handlers refuse, no provider call', () => {
  const t = results.minorDown;

  for (const name of HANDLERS) {
    const r = t[name];
    assert.ok(r.profileDelta >= 1, `${name}: profile store consulted`);
    assert.equal(r.code, 200, `${name}: refusal is the standard 200 shape`);
    assert.equal(r.refusal, true, `${name}: standard refusal returned`);
    assert.equal(r.providerDelta, 0, `${name}: provider never called`);
  }
});

test('handler pins (bite 3): request safety fields cannot weaken a minor profile', () => {
  const t = results.minorWeaken;

  // Every request claimed safetyMode:false + ageBand:'adult'; the
  // 9-12 profile decided anyway (moderation down + fail-closed).
  for (const name of HANDLERS) {
    const r = t[name];
    assert.ok(r.profileDelta >= 1, `${name}: profile store consulted`);
    assert.equal(r.refusal, true, `${name}: refused despite the request claiming adult`);
    assert.equal(r.providerDelta, 0, `${name}: provider never called`);
  }
});

test('handler pins (bite 3): throwing profile store -> safe default refuses, request inputs never used', () => {
  const t = results.throws;

  for (const name of HANDLERS) {
    const r = t[name];
    assert.ok(r.profileDelta >= 1, `${name}: profile store consulted`);
    assert.equal(r.refusal, true, `${name}: safe default refused (requests claimed adult)`);
    assert.equal(r.providerDelta, 0, `${name}: provider never called`);
  }
});

test('handler pins (bite 3): adult profile + clean moderation -> the provider path proceeds for all four', () => {
  const t = results.adultClean;

  for (const name of HANDLERS) {
    const r = t[name];
    assert.ok(r.profileDelta >= 1, `${name}: profile store consulted`);
    assert.equal(r.code, 200, `${name}: generation completed`);
    assert.equal(r.refusal, false, `${name}: not refused`);
    assert.ok(r.providerDelta >= 1, `${name}: provider was called`);
    assert.ok(r.url, `${name}: a media URL came back`);
  }
});

test('handler pins (bite 3): compat mode is unchanged — request safety decides, zero profile queries', () => {
  const t = results.compat;

  // No SESSION_SECRET: the requests were served exactly as before
  // this bite (clean moderation, neutral request safety -> the
  // provider path proceeds), and the profile store was never
  // touched — the fake store was set to throw, so a single query
  // would have changed the outcome.
  for (const name of HANDLERS) {
    const r = t[name];
    assert.equal(r.profileDelta, 0, `${name}: compat mode makes NO profile query`);
    assert.equal(r.code, 200, `${name}: generation completed`);
    assert.equal(r.refusal, false, `${name}: not refused`);
    assert.ok(r.providerDelta >= 1, `${name}: provider was called`);
  }
});
