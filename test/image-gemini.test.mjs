// test/image-gemini.test.mjs — provider wiring bite G1
// (provider-inventory §4): handler-level pins for the new Gemini
// image route (server/handlers/image-gemini.js), born profile-aware
// on Bite 1's resolveProfileSafety pattern and storing media under
// Bite 4's tenant-correct identity.
//
// Pinned here: the generateContent request shape and the pinned
// current model (gemini-3.1-flash-image, from Google's official
// pricing + image-generation docs at build time); fake image bytes
// re-hosted to Blob under the tenant prefix with the URL returned;
// a moderation-flagged prompt refused with zero provider calls; a
// minor profile's decision coming from the profile, not request
// inputs; a missing Gemini key answering the standard 500 with zero
// provider calls; the metered bucket gate consulted BEFORE the
// provider call (and denying an exhausted bucket with no call at
// all); provider failures storing and charging nothing; and compat
// mode making no profile query.
//
// The handler runs in a child process with module mocks — see
// test/fixtures/image-gemini-child.mjs. NOT covered: any live
// deployment or live provider (the child stubs fetch at the
// boundary and counts calls; zero live provider calls are made).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/image-gemini-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  return JSON.parse(line);
}

const results = runChild();
const TENANT = '33333333-3333-4333-8333-333333333333';
const MODEL = 'gemini-3.1-flash-image';

test('gemini image (G1): request shape + pinned model on the generateContent route', () => {
  const r = results.meteredShape;
  assert.equal(r.code, 200);
  assert.equal(r.providerDelta, 1, 'exactly one provider call');
  const req = r.request;
  assert.ok(req, 'the provider request was captured');
  assert.equal(req.method, 'POST');
  assert.equal(
    req.url,
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
    'generateContent URL carries the pinned model id',
  );
  assert.equal(req.headers['x-goog-api-key'], 'g1-gemini-not-real', 'key travels in the x-goog-api-key header');
  assert.deepEqual(req.body.contents, [{ parts: [{ text: 'a frog on a log' }] }]);
  assert.deepEqual(req.body.generationConfig.responseModalities, ['TEXT', 'IMAGE']);
  assert.equal(req.body.generationConfig.imageConfig.aspectRatio, '16:9', 'landscape aspect maps to 16:9');
  assert.equal(r.modelField, MODEL, 'the response names the pinned model');
  assert.equal(r.providerField, 'gemini');
});

test('gemini image (G1): image bytes re-hosted to Blob under the tenant prefix, URL returned', () => {
  const r = results.meteredShape;
  assert.equal(r.puts.length, 2, 'image + meta sidecar written');
  assert.ok(r.puts[0].startsWith(`thinkinbuddy/images/${TENANT}/`), `image under the tenant prefix: ${r.puts[0]}`);
  assert.ok(r.puts[0].endsWith('.png'), 'png extension from the returned mime type');
  assert.ok(r.puts[1].startsWith(`thinkinbuddy/images/${TENANT}/`), 'sidecar under the same prefix');
  assert.ok(r.puts[1].endsWith('.meta.json'), 'sidecar is the caption file');
  assert.equal(r.url, `https://blob.test/${r.puts[0]}`, 'the returned URL is the stored image');
  assert.deepEqual(r.pgUsers, [TENANT], 'media memory is keyed by the resolved tenant (bite 4)');
});

test('gemini image (G1): metered mode — bucket gate consulted BEFORE the provider call, ledger charged 5 credits', () => {
  const r = results.meteredShape;
  assert.ok(r.gateIdx >= 0, 'the bucket gate ran (env key, enforced mode)');
  assert.ok(r.providerIdx >= 0, 'the provider was called');
  assert.ok(r.gateIdx < r.providerIdx, 'gate consulted before the provider call');
  assert.equal(r.ledger.length, 1, 'one ledger row written after success');
  const [, provider, unit, costMicros] = r.ledger[0];
  assert.equal(provider, 'google');
  assert.equal(unit, 'image x1');
  assert.equal(costMicros, 5000, 'the shared image action costs 5 credits');
});

test('gemini image (G1): exhausted bucket — the gate denies with 402 and the provider is never called', () => {
  const r = results.exhausted;
  assert.equal(r.code, 402);
  assert.equal(r.error, 'credits_exhausted');
  assert.ok(r.gateIdx >= 0, 'the gate ran');
  assert.equal(r.providerDelta, 0, 'no provider call past a denied gate');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('gemini image (G1): moderation-flagged prompt -> standard refusal, zero provider calls', () => {
  const r = results.flagged;
  assert.equal(r.code, 200, 'refusal is the standard 200 shape');
  assert.equal(r.refusal, true);
  assert.equal(r.providerDelta, 0, 'provider never called');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('gemini image (G1): minor profile decides from the profile — moderation down still refuses', () => {
  const r = results.minorDown;
  assert.ok(r.profileDelta >= 1, 'profile store consulted');
  assert.equal(r.refusal, true, 'profile-derived fail-closed refused when moderation was unavailable');
  assert.equal(r.providerDelta, 0, 'provider never called');
});

test('gemini image (G1): request safety fields cannot weaken a minor profile', () => {
  const r = results.minorWeaken;
  assert.ok(r.profileDelta >= 1, 'profile store consulted');
  assert.equal(r.refusal, true, 'refused despite the request claiming adult / safety off');
  assert.equal(r.providerDelta, 0, 'provider never called');
});

test('gemini image (G1): missing Gemini key -> standard 500, zero provider calls', () => {
  const r = results.missingKey;
  assert.equal(r.code, 500);
  assert.equal(r.result, 'GEMINI_API_KEY not configured');
  assert.equal(r.providerDelta, 0, 'provider never called');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('gemini image (G1): provider failure -> speakable 502, nothing stored, nothing charged', () => {
  const r = results.providerErr;
  assert.equal(r.code, 502);
  assert.ok(r.result?.startsWith('Gemini image generation failed:'), `speakable failure: ${r.result}`);
  assert.equal(r.providerDelta, 1, 'the provider was attempted');
  assert.equal(r.puts.length, 0, 'nothing stored');
  assert.equal(r.ledger.length, 0, 'no ledger charge for a failed generation');
});

test('gemini image (G1): no image in the response -> 502, nothing stored', () => {
  const r = results.noImage;
  assert.equal(r.code, 502);
  assert.equal(r.result, 'Gemini returned no image data');
  assert.equal(r.puts.length, 0, 'nothing stored');
  assert.equal(r.ledger.length, 0, 'no ledger charge');
});

test('gemini image (G1): compat mode — legacy identity keys storage, zero profile queries', () => {
  const r = results.compat;
  assert.equal(r.profileDelta, 0, 'compat mode makes NO profile query');
  assert.equal(r.code, 200, 'generation completed');
  assert.equal(r.providerDelta, 1, 'provider called on the BYO key');
  assert.ok(r.puts[0]?.startsWith('thinkinbuddy/images/legacy-user/'), `legacy prefix: ${r.puts[0]}`);
  assert.deepEqual(r.pgUsers, ['legacy-user'], 'media memory keyed by the legacy userId');
});
