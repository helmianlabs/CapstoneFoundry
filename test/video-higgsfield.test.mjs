// test/video-higgsfield.test.mjs — provider wiring bite H1:
// handler-level pins for the new Higgsfield video route
// (server/handlers/video-higgsfield.js), born profile-aware on
// Bite 1's resolveProfileSafety pattern and storing media under
// Bite 4's tenant-correct identity.
//
// The API contract was pinned at build time from Higgsfield's OWN
// official docs (Quickstart, FAQ, Requests-and-lifecycle, and the
// Kling 2.5 Turbo Pro text-to-video workflow page on
// docs.higgsfield.ai; price from the workflow's model page on
// open.higgsfield.ai): POST /kling-video/v2.5-turbo/pro/text-to-video
// with ONE auth header `Authorization: Key <key-id>:<secret>`
// carrying the Console credential pair, an Idempotency-Key header,
// and body { prompt, duration: 5 | 10 }; then poll the returned
// status_url (queued / in_progress -> completed / failed / nsfw /
// canceled) and read the output from { video: { url } }.
//
// Pinned here: the documented request shape and auth construction
// (verified as booleans against the fake pair — the fixture never
// emits the credential value); the stubbed async flow submit ->
// polls -> download; fake MP4 bytes re-hosted to Blob under the
// tenant prefix with the URL returned; the DEDICATED
// video_higgsfield meter rate (75 credits/s, fitted to the shipped
// workflow's published LIST price of $0.07/s — never Runway's 60
// or Omni's 110) with the bucket gate consulted BEFORE the provider
// call and an exhausted bucket denied with no call at all; the
// documented 5s default metering 375; a moderation-flagged prompt
// refused with zero provider calls; a minor profile's decision
// coming from the profile, not request inputs; EITHER half of the
// credential pair missing answering the standard 500 with zero
// provider calls; provider-side failures (submit 500, job
// 'failed') storing and charging nothing; the provider's own
// 'nsfw' outcome answered as a speakable 200 with nothing stored
// or charged; and compat mode making no profile query.
//
// The handler runs in a child process with module mocks — see
// test/fixtures/video-higgsfield-child.mjs. NOT covered: any live
// deployment or live provider (the child stubs fetch at the
// boundary and counts calls; zero live provider calls are made).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CREDIT_COSTS, costFor } from '../lib/usage.js';

// ─── The dedicated Higgsfield rate (pure unit pins) ────────────────

test('higgsfield rate (H1): video_higgsfield is its own rate — 75 credits/s fitted to the $0.07/s list price', () => {
  assert.equal(CREDIT_COSTS.video_higgsfield_per_second, 75);
  assert.equal(costFor('video_higgsfield', { seconds: 5 }), 375, 'the documented 5s clip');
  assert.equal(costFor('video_higgsfield', { seconds: 10 }), 750, 'the documented 10s clip');
  assert.equal(costFor('video_higgsfield', { seconds: 0 }), 30, 'the shared per-job floor still applies');
  assert.equal(costFor('video_higgsfield', { duration: 10 }), 750, 'duration alias works like the video actions');
  // The other providers' rates are untouched and distinct.
  assert.equal(CREDIT_COSTS.video_per_second, 60, 'Runway rate unchanged');
  assert.equal(CREDIT_COSTS.video_omni_per_second, 110, 'Omni rate unchanged');
  assert.equal(costFor('video', { seconds: 10 }), 600);
  assert.equal(costFor('video_omni', { seconds: 10 }), 1100);
});

// ─── Handler-level pins (child process, stubbed fetch) ─────────────

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/video-higgsfield-child.mjs', import.meta.url));
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
const MODEL = 'kling-video/v2.5-turbo/pro/text-to-video';

test('higgsfield video (H1): documented request shape + credential-pair auth construction', () => {
  const r = results.meteredShape;
  assert.equal(r.code, 200);
  const req = r.submit;
  assert.ok(req, 'the submit request was captured');
  assert.equal(req.method, 'POST');
  assert.equal(
    req.url,
    'https://api.higgsfield.ai/kling-video/v2.5-turbo/pro/text-to-video',
    'the documented workflow endpoint on the documented base',
  );
  // The pair travels as ONE `Key <id>:<secret>` header — checked as
  // construction booleans; the fixture never emits the value.
  assert.equal(req.authWellFormed, true, 'Authorization is a Key <id>:<secret> header');
  assert.equal(req.authIdMatches, true, 'the id half is the configured key id');
  assert.equal(req.authSecretMatches, true, 'the secret half is the configured secret');
  assert.equal(req.hasIdempotencyKey, true, 'an Idempotency-Key header rides the submit (docs)');
  assert.deepEqual(
    req.body,
    { prompt: 'a frog on a log', duration: 10 },
    'the documented body: prompt + duration, no invented fields (this endpoint has no aspect_ratio)',
  );
  assert.equal(r.modelField, MODEL, 'the response names the shipped workflow');
  assert.equal(r.providerField, 'higgsfield');
});

test('higgsfield video (H1): the documented async flow runs submit -> polls -> download', () => {
  const r = results.meteredShape;
  assert.deepEqual(
    r.flow,
    ['submit', 'poll', 'poll', 'download'],
    'submit accepted (queued), status in_progress -> completed on the returned status_url, then the output download',
  );
  assert.equal(r.providerDelta, 3, 'submit + two status polls are the Higgsfield calls (the download is the CDN URL)');
});

test('higgsfield video (H1): MP4 re-hosted to Blob under the tenant prefix, URL returned', () => {
  const r = results.meteredShape;
  assert.equal(r.puts.length, 2, 'video + meta sidecar written');
  assert.ok(r.puts[0].startsWith(`thinkinbuddy/videos/${TENANT}/`), `video under the tenant prefix: ${r.puts[0]}`);
  assert.ok(r.puts[0].endsWith('.mp4'), 'mp4 extension');
  assert.ok(r.puts[1].startsWith(`thinkinbuddy/videos/${TENANT}/`), 'sidecar under the same prefix');
  assert.ok(r.puts[1].endsWith('.meta.json'), 'sidecar is the caption file');
  assert.equal(r.url, `https://blob.test/${r.puts[0]}`, 'the returned URL is the stored video — never the provider URL (7-day retention)');
  assert.deepEqual(r.pgUsers, [TENANT], 'media memory is keyed by the resolved tenant (bite 4)');
});

test('higgsfield video (H1): metered mode — gate BEFORE the provider call, ledger charged 750 on video_higgsfield', () => {
  const r = results.meteredShape;
  assert.ok(r.gateIdx >= 0, 'the bucket gate ran (env pair, enforced mode)');
  assert.ok(r.providerIdx >= 0, 'the provider was called');
  assert.ok(r.gateIdx < r.providerIdx, 'gate consulted before the provider call');
  assert.equal(r.ledger.length, 1, 'one ledger row written after success');
  const [, provider, unit, costMicros] = r.ledger[0];
  assert.equal(provider, 'higgsfield');
  assert.equal(unit, 'video_higgsfield x10', 'the Higgsfield action at the requested 10s');
  assert.equal(costMicros, 750_000, '75 credits/s x 10s = 750 credits — the dedicated rate, not Runway’s 600 or Omni’s 1100');
});

test('higgsfield video (H1): no duration in the body -> the documented default 5 is submitted and metered', () => {
  const r = results.defaultDuration;
  assert.equal(r.code, 200);
  assert.equal(r.submit.body.duration, 5, 'the workflow default duration');
  assert.equal(r.ledger.length, 1, 'one ledger row');
  const [, , unit, costMicros] = r.ledger[0];
  assert.equal(unit, 'video_higgsfield x5');
  assert.equal(costMicros, 375_000, '75 credits/s x 5s = 375 credits');
});

test('higgsfield video (H1): exhausted bucket — the gate denies with 402 and the provider is never called', () => {
  const r = results.exhausted;
  assert.equal(r.code, 402);
  assert.equal(r.error, 'credits_exhausted');
  assert.ok(r.gateIdx >= 0, 'the gate ran');
  assert.equal(r.providerDelta, 0, 'no provider call past a denied gate');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('higgsfield video (H1): moderation-flagged prompt -> standard refusal, zero provider calls', () => {
  const r = results.flagged;
  assert.equal(r.code, 200, 'refusal is the standard 200 shape');
  assert.equal(r.refusal, true);
  assert.equal(r.providerDelta, 0, 'provider never called');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('higgsfield video (H1): minor profile decides from the profile — moderation down still refuses', () => {
  const r = results.minorDown;
  assert.ok(r.profileDelta >= 1, 'profile store consulted');
  assert.equal(r.refusal, true, 'profile-derived fail-closed refused when moderation was unavailable');
  assert.equal(r.providerDelta, 0, 'provider never called');
});

test('higgsfield video (H1): request safety fields cannot weaken a minor profile', () => {
  const r = results.minorWeaken;
  assert.ok(r.profileDelta >= 1, 'profile store consulted');
  assert.equal(r.refusal, true, 'refused despite the request claiming adult / safety off');
  assert.equal(r.providerDelta, 0, 'provider never called');
});

test('higgsfield video (H1): missing credential SECRET half -> standard 500, zero provider calls', () => {
  const r = results.missingSecret;
  assert.equal(r.code, 500);
  assert.equal(r.result, 'HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_SECRET not configured');
  assert.equal(r.providerDelta, 0, 'provider never called');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('higgsfield video (H1): missing credential ID half -> standard 500, zero provider calls', () => {
  const r = results.missingId;
  assert.equal(r.code, 500);
  assert.equal(r.result, 'HIGGSFIELD_API_KEY_ID / HIGGSFIELD_API_SECRET not configured');
  assert.equal(r.providerDelta, 0, 'provider never called');
  assert.equal(r.puts.length, 0, 'nothing stored');
});

test('higgsfield video (H1): submit failure -> speakable 502, nothing stored, nothing charged', () => {
  const r = results.providerErr;
  assert.equal(r.code, 502);
  assert.ok(r.result?.startsWith('Higgsfield video generation failed:'), `speakable failure: ${r.result}`);
  assert.equal(r.providerDelta, 1, 'only the submit was attempted');
  assert.equal(r.puts.length, 0, 'nothing stored');
  assert.equal(r.ledger.length, 0, 'no ledger charge for a failed generation');
});

test('higgsfield video (H1): job polls to failed -> 502, no download, nothing stored or charged', () => {
  const r = results.failedStatus;
  assert.equal(r.code, 502);
  assert.ok(r.result?.includes('request failed'), `speakable failure: ${r.result}`);
  assert.deepEqual(r.flow, ['submit', 'poll', 'poll'], 'the flow stopped at the failed status');
  assert.equal(r.puts.length, 0, 'nothing stored');
  assert.equal(r.ledger.length, 0, 'no ledger charge');
});

test('higgsfield video (H1): provider nsfw outcome -> speakable 200, nothing stored or charged', () => {
  const r = results.nsfwStatus;
  assert.equal(r.code, 200, "the provider's own moderation outcome is a content answer, not a system failure");
  assert.ok(r.result?.includes('safety filter blocked'), `speakable outcome: ${r.result}`);
  assert.equal(r.puts.length, 0, 'nothing stored');
  assert.equal(r.ledger.length, 0, 'no ledger charge (Higgsfield does not charge nsfw-flagged requests)');
});

test('higgsfield video (H1): compat mode — legacy identity keys storage, BYO pair serves, zero profile queries', () => {
  const r = results.compat;
  assert.equal(r.profileDelta, 0, 'compat mode makes NO profile query');
  assert.equal(r.code, 200, 'generation completed');
  assert.ok(r.providerDelta >= 1, 'provider called on the BYO pair');
  assert.equal(r.submit.authWellFormed, true, 'the BYO pair built the same documented header');
  assert.equal(r.submit.authIdMatches, true, 'the id half came from the request, not env');
  assert.equal(r.submit.authSecretMatches, true, 'the secret half came from the request, not env');
  assert.ok(r.puts[0]?.startsWith('thinkinbuddy/videos/legacy-user/'), `legacy prefix: ${r.puts[0]}`);
  assert.deepEqual(r.pgUsers, ['legacy-user'], 'media memory keyed by the legacy userId');
});
