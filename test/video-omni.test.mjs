// test/video-omni.test.mjs — provider wiring bite G2′
// (re-spec of G2 from bite-g2-report.md): handler-level pins for
// the new Google Omni Flash video route
// (server/handlers/video-omni.js), born profile-aware on Bite 1's
// resolveProfileSafety pattern and storing media under Bite 4's
// tenant-correct identity.
//
// Pinned here: the Interactions API request shape and the pinned
// current model (gemini-omni-1.1-flash, from Google's official
// Omni / Interactions / background-execution docs at build time);
// the documented async flow (background create -> interaction
// polls -> Files-API state polls -> download) run end to end
// against stubs; fake MP4 bytes re-hosted to Blob under the tenant
// prefix with the URL returned; the SEPARATE video_omni meter rate
// (110 credits/s, token-priced from Google's pricing page — never
// the Runway rate) charged at the documented 10s maximum, with the
// bucket gate consulted BEFORE the provider call and an exhausted
// bucket denied with no call at all; a moderation-flagged prompt
// refused with zero provider calls; a minor profile's decision
// coming from the profile, not request inputs; a missing Gemini
// key answering the standard 500 with zero provider calls;
// provider-side failures (create 500, interaction 'failed', file
// state FAILED) storing and charging nothing; and compat mode
// making no profile query.
//
// The handler runs in a child process with module mocks — see
// test/fixtures/video-omni-child.mjs. NOT covered: any live
// deployment or live provider (the child stubs fetch at the
// boundary and counts calls; zero live provider calls are made).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CREDIT_COSTS, costFor } from '../lib/usage.js';

// ─── The separate Omni rate (pure unit pins) ───────────────────────

test('omni rate (G2′): video_omni is its own rate — 110 credits/s, never the Runway 60', () => {
  assert.equal(CREDIT_COSTS.video_omni_per_second, 110);
  assert.equal(costFor('video_omni', { seconds: 10 }), 1100, 'the documented 10s maximum at 720p');
  assert.equal(costFor('video_omni', { seconds: 3 }), 330, 'the documented 3s minimum output');
  assert.equal(costFor('video_omni', { seconds: 0 }), 30, 'the shared per-job floor still applies');
  assert.equal(costFor('video_omni', { duration: 10 }), 1100, 'duration alias works like the video action');
  // The Runway rate is untouched and distinct.
  assert.equal(CREDIT_COSTS.video_per_second, 60);
  assert.equal(costFor('video', { seconds: 10 }), 600);
});

// ─── Handler-level pins (child process, stubbed fetch) ─────────────

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/video-omni-child.mjs', import.meta.url));
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
const MODEL = 'gemini-omni-1.1-flash';

test('omni video (G2′): request shape + pinned model on the Interactions route', () => {
  const r = results.meteredShape;
  assert.equal(r.code, 200);
  const req = r.create;
  assert.ok(req, 'the create request was captured');
  assert.equal(req.method, 'POST');
  assert.equal(
    req.url,
    'https://generativelanguage.googleapis.com/v1beta/interactions',
    'the Interactions API endpoint — not predictLongRunning',
  );
  assert.equal(req.headers['x-goog-api-key'], 'g2p-gemini-not-real', 'key travels in the x-goog-api-key header');
  assert.equal(req.body.model, MODEL, 'the pinned Omni Flash model id');
  assert.equal(req.body.input, 'a frog on a log', 'the prompt is the interaction input');
  assert.equal(req.body.background, true, 'background execution — video outlives one HTTP request');
  assert.deepEqual(
    req.body.response_format,
    { type: 'video', aspect_ratio: '9:16', resolution: '720p', delivery: 'uri' },
    'portrait aspect maps to 9:16; resolution pinned to the metered 720p; URI delivery per the docs',
  );
  assert.equal(r.modelField, MODEL, 'the response names the pinned model');
  assert.equal(r.providerField, 'google');
});

test('omni video (G2′): the documented async flow runs create -> polls -> file polls -> download', () => {
  const r = results.meteredShape;
  assert.deepEqual(
    r.flow,
    ['create', 'poll', 'poll', 'file', 'file', 'download'],
    'background create, interaction in_progress -> completed, file PROCESSING -> ACTIVE, then the download',
  );
  assert.equal(r.providerDelta, 6, 'every Google call is one of the documented flow steps');
});

test('omni video (G2′): MP4 re-hosted to Blob under the tenant prefix, URL returned', () => {
  const r = results.meteredShape;
  assert.equal(r.puts.length, 2, 'video + meta sidecar written');
  assert.ok(r.puts[0].startsWith(`thinkinbuddy/videos/${TENANT}/`), `video under the tenant prefix: ${r.puts[0]}`);
  assert.ok(r.puts[0].endsWith('.mp4'), 'mp4 extension');
  assert.ok(r.puts[1].startsWith(`thinkinbuddy/videos/${TENANT}/`), 'sidecar under the same prefix');
  assert.ok(r.puts[1].endsWith('.meta.json'), 'sidecar is the caption file');
  assert.equal(r.url, `https://blob.test/${r.puts[0]}`, 'the returned URL is the stored video');
  assert.deepEqual(r.pgUsers, [TENANT], 'media memory is keyed by the resolved tenant (bite 4)');
});

test('omni video (G2′): metered mode — gate BEFORE the provider call, ledger charged 1100 on video_omni', () => {
  const r = results.meteredShape;
  assert.ok(r.gateIdx >= 0, 'the bucket gate ran (env key, enforced mode)');
  assert.ok(r.providerIdx >= 0, 'the provider was called');
  assert.ok(r.gateIdx < r.providerIdx, 'gate consulted before the provider call');
  assert.equal(r.ledger.length, 1, 'one ledger row written after success');
  const [, provider, unit, costMicros] = r.ledger[0];
  assert.equal(provider, 'google');
  assert.equal(unit, 'video_omni x10', 'the Omni action at the documented 10s maximum');
  assert.equal(costMicros, 1_100_000, '110 credits/s x 10s = 1100 credits — the Omni rate, not Runway’s 600');
});

test('omni video (G2′): exhausted bucket — the gate denies with 402 and the provider is never called', () => {
  const r = results.exhausted;
  assert.equal(r.code, 402);
  assert.equal(r.error, 'credits_exhausted');
  assert.ok(r.gateIdx >= 0, 'the gate ran');
  assert.equal(r.providerDelta, 0, 'no provider call past a denied gate');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('omni video (G2′): moderation-flagged prompt -> standard refusal, zero provider calls', () => {
  const r = results.flagged;
  assert.equal(r.code, 200, 'refusal is the standard 200 shape');
  assert.equal(r.refusal, true);
  assert.equal(r.providerDelta, 0, 'provider never called');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('omni video (G2′): minor profile decides from the profile — moderation down still refuses', () => {
  const r = results.minorDown;
  assert.ok(r.profileDelta >= 1, 'profile store consulted');
  assert.equal(r.refusal, true, 'profile-derived fail-closed refused when moderation was unavailable');
  assert.equal(r.providerDelta, 0, 'provider never called');
});

test('omni video (G2′): request safety fields cannot weaken a minor profile', () => {
  const r = results.minorWeaken;
  assert.ok(r.profileDelta >= 1, 'profile store consulted');
  assert.equal(r.refusal, true, 'refused despite the request claiming adult / safety off');
  assert.equal(r.providerDelta, 0, 'provider never called');
});

test('omni video (G2′): missing Gemini key -> standard 500, zero provider calls', () => {
  const r = results.missingKey;
  assert.equal(r.code, 500);
  assert.equal(r.result, 'GEMINI_API_KEY not configured');
  assert.equal(r.providerDelta, 0, 'provider never called');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('omni video (G2′): create failure -> speakable 502, nothing stored, nothing charged', () => {
  const r = results.providerErr;
  assert.equal(r.code, 502);
  assert.ok(r.result?.startsWith('Omni video generation failed:'), `speakable failure: ${r.result}`);
  assert.equal(r.providerDelta, 1, 'only the create was attempted');
  assert.equal(r.puts.length, 0, 'nothing stored');
  assert.equal(r.ledger.length, 0, 'no ledger charge for a failed generation');
});

test('omni video (G2′): interaction polls to failed -> 502, no download, nothing stored or charged', () => {
  const r = results.failedStatus;
  assert.equal(r.code, 502);
  assert.ok(r.result?.includes('interaction failed'), `speakable failure: ${r.result}`);
  assert.deepEqual(r.flow, ['create', 'poll', 'poll'], 'the flow stopped at the failed status');
  assert.equal(r.puts.length, 0, 'nothing stored');
  assert.equal(r.ledger.length, 0, 'no ledger charge');
});

test('omni video (G2′): file state FAILED -> 502, no download, nothing stored or charged', () => {
  const r = results.fileFailed;
  assert.equal(r.code, 502);
  assert.ok(!r.flow.includes('download'), 'a FAILED file is never downloaded');
  assert.equal(r.puts.length, 0, 'nothing stored');
  assert.equal(r.ledger.length, 0, 'no ledger charge');
});

test('omni video (G2′): compat mode — legacy identity keys storage, zero profile queries', () => {
  const r = results.compat;
  assert.equal(r.profileDelta, 0, 'compat mode makes NO profile query');
  assert.equal(r.code, 200, 'generation completed');
  assert.ok(r.providerDelta >= 1, 'provider called on the BYO key');
  assert.ok(r.puts[0]?.startsWith('thinkinbuddy/videos/legacy-user/'), `legacy prefix: ${r.puts[0]}`);
  assert.deepEqual(r.pgUsers, ['legacy-user'], 'media memory keyed by the legacy userId');
});
