// test/media-identity-chain.test.mjs — safety wiring bite 4
// (safety-gap-map §7): the media identity chain is tenant-correct
// end to end.
//
// Pinned here: in enforced mode a generation whose request body
// CLAIMS another tenant's userId still stores its Blob objects and
// its media-memory row under the RESOLVED tenant (from the session
// token); the same tenant's latest-media pollers then retrieve the
// media, and a second tenant's pollers retrieve nothing. In compat
// mode the legacy request userId keys storage exactly as before and
// the compat poller finds it, with zero profile queries.
//
// The handlers and pollers run in a child process with module mocks
// sharing one in-memory Blob bucket — see
// test/fixtures/media-identity-chain-child.mjs. NOT covered: any live
// deployment, live provider, or the deployed ElevenLabs agent's tool
// schemas (the provisioning contract is pinned separately in
// test/agent-tool-identity.test.mjs; live readback is still owed).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/media-identity-chain-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 120_000, // the Veo success flow polls on a real 4s timer
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  return JSON.parse(line);
}

const results = runChild();
const TENANT_A = '22222222-2222-4222-8222-222222222222';
const TENANT_B = '33333333-3333-4333-8333-333333333333';

test('enforced generation stores under the resolved tenant, never the claimed userId', () => {
  for (const [label, r, kind] of [
    ['image', results.enforcedImage, 'images'],
    ['video', results.enforcedVideo, 'videos'],
  ]) {
    assert.equal(r.code, 200, `${label}: generation completed`);
    assert.ok(r.putPaths.length >= 1, `${label}: media was stored`);
    for (const path of r.putPaths) {
      assert.ok(
        path.startsWith(`thinkinbuddy/${kind}/${TENANT_A}/`),
        `${label}: stored under the resolved tenant: ${path}`,
      );
      assert.ok(!path.includes(TENANT_B), `${label}: claimed identity never keys storage: ${path}`);
    }
    assert.deepEqual(r.insertUserIds, [TENANT_A], `${label}: media-memory row keyed by the resolved tenant`);
  }
});

test("the same tenant's pollers retrieve the media; a second tenant's retrieve nothing", () => {
  assert.ok(results.pollImageA.url?.includes(`/images/${TENANT_A}/`), 'image poller A finds the image');
  assert.equal(results.pollImageB.url, null, 'image poller B finds nothing');
  assert.ok(results.pollVideoA.url?.includes(`/videos/${TENANT_A}/`), 'video poller A finds the video');
  assert.equal(results.pollVideoB.url, null, 'video poller B finds nothing');
});

test('compat mode keeps the legacy userId behavior end to end', () => {
  const r = results.compatImage;
  assert.equal(r.code, 200, 'compat generation completed');
  assert.ok(r.putPaths.length >= 1, 'compat media was stored');
  for (const path of r.putPaths) {
    assert.ok(path.startsWith('thinkinbuddy/images/legacy-user/'), `compat stores under the legacy userId: ${path}`);
  }
  assert.deepEqual(r.insertUserIds, ['legacy-user'], 'compat media-memory row keyed by the legacy userId');
  assert.equal(results.compatProfileDelta, 0, 'compat mode makes NO profile query');
  assert.ok(results.pollImageCompat.url?.includes('/images/legacy-user/'), 'compat poller finds the legacy media');
  assert.equal(results.pollImageCompatOther.url, null, 'compat poller under another id finds nothing');
});
