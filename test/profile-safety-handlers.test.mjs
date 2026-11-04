// test/profile-safety-handlers.test.mjs — safety wiring bite 1
// (safety-gap-map §7): handler-level pins for the shared
// profile-safety resolver.
//
// The resolver matrix itself is pinned in test/profile.test.mjs.
// This file pins what the matrix cannot: that the four profile-aware
// handlers (chat, speak, image, video) actually OBEY the resolver
// when the profile store fails — with a throwing fake profile store
// and moderation unavailable, a hosted request is REFUSED and no
// provider (and no LLM) is ever called; a request claiming
// safetyMode:false / ageBand:'adult' cannot weaken a minor profile;
// and compat mode is untouched (request safety decides, zero profile
// queries).
//
// The handlers run in a child process with module mocks (their DB
// seam cannot load in the suite) — see
// test/fixtures/profile-safety-handler-child.mjs. NOT covered: any
// live deployment or live provider (the child stubs fetch at the
// boundary and counts calls).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/profile-safety-handler-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  return JSON.parse(line);
}

test('handler pins (bite 1): throwing profile store + moderation down -> all four handlers refuse, no provider/LLM call', () => {
  const { throws: t } = runChild();

  // The store really was consulted on every path (the pin is not
  // vacuous — a handler that skipped the profile would show 0).
  for (const [name, r] of Object.entries(t)) {
    assert.ok(r.profileDelta >= 1, `${name}: profile store consulted`);
    assert.equal(r.code, 200, `${name}: refusal is the standard 200 shape`);
  }
  assert.match(t.chat.reply, /keep it friendly/);
  assert.equal(t.chat.llmDelta, 0, 'chat: LLM never called');
  assert.equal(t.speak.refusal, true, 'speak: standard refusal returned');
  assert.equal(t.speak.ttsDelta, 0, 'speak: ElevenLabs never called');
  assert.equal(t.image.refusal, true, 'image: standard refusal returned');
  assert.equal(t.image.providerDelta, 0, 'image: OpenAI images never called');
  assert.equal(t.video.refusal, true, 'video: standard refusal returned');
  assert.equal(t.video.providerDelta, 0, 'video: Runway/OpenAI never called');
});

test('handler pins (bite 1): request safety fields cannot weaken a minor profile', () => {
  const { minorWeaken: t } = runChild();

  // Every request claimed safetyMode:false + ageBand:'adult'; the
  // 9-12 profile decided anyway (moderation down + fail-closed).
  assert.match(t.chat.reply, /keep it friendly/);
  assert.equal(t.chat.llmDelta, 0, 'chat: LLM never called');
  assert.equal(t.speak.refusal, true, 'speak: refused despite the request claiming adult');
  assert.equal(t.speak.ttsDelta, 0);
  assert.equal(t.image.refusal, true, 'image: refused despite the request claiming adult');
  assert.equal(t.image.providerDelta, 0);
  assert.equal(t.video.refusal, true, 'video: refused despite the request claiming adult');
  assert.equal(t.video.providerDelta, 0);
});

test('handler pins (bite 1): the profile reaches the chat prompt — minor gets the kid core, adult does not', () => {
  const { minorClean, adultClean } = runChild();

  assert.equal(minorClean.chat.code, 200);
  assert.equal(minorClean.chat.llmDelta, 1, 'clean moderation lets the minor chat through to the LLM');
  assert.equal(minorClean.chat.baseRules, true, 'base guardrails always present');
  assert.equal(minorClean.chat.kidCore, true, 'minor profile -> KID_SAFETY_CORE in the system prompt');
  assert.equal(minorClean.chat.reply, 'A friendly reply about frogs.');

  assert.equal(adultClean.chat.code, 200);
  assert.equal(adultClean.chat.llmDelta, 1);
  assert.equal(adultClean.chat.baseRules, true, 'base guardrails always present');
  assert.equal(adultClean.chat.kidCore, false, 'adult profile, safety off -> no kid core');
});

test('handler pins (bite 1): enforced chat with no resolvable tenant is rejected; compat mode is unchanged', () => {
  const { noTenant, compat } = runChild();

  assert.equal(noTenant.chat.code, 401);
  assert.equal(noTenant.chat.error, 'Unauthorized');
  assert.equal(noTenant.chat.llmDelta, 0, 'rejected before the LLM');

  // Compat (no SESSION_SECRET): the request is served under request
  // safety exactly as before this bite, and the profile store is
  // never touched — the fake store was set to throw, and a single
  // query would have changed the outcome.
  assert.equal(compat.chat.code, 200);
  assert.equal(compat.chat.llmDelta, 1, 'compat chat still reaches the LLM');
  assert.equal(compat.chat.profileDelta, 0, 'compat mode makes NO profile query');
  assert.equal(compat.chat.kidCore, false, 'compat request safety (neutral) builds no kid core');
});
