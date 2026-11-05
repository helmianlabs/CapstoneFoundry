// test/memory-handlers.test.mjs — memory-fix bite (2026-11-05).
//
// Pins the three production failures the research proved and the fixes
// for them, through the REAL handlers in a child process with the DB /
// OpenAI / LLM seams faked (test/fixtures/memory-fix-handler-child.mjs):
//   1. Recall returned the boot top-5 for every query (silent embed
//      fallback). Now: a working embed yields mode 'vector' and the
//      semantically-right row first; a failing embed yields mode
//      'boot-fallback' — visible, never silent. Limit is 8, not 5.
//   2. Nothing was written during a session. Now: checkpoint-memories
//      extracts from the server-captured turns MID-session, advances a
//      cursor, respects a minimum-turn threshold unless forced (the
//      drop-off flush), and never advances the cursor when extraction
//      is skipped (no LLM) so the slice is retried.
//   3. Session-end saving depended on the client + a re-fetchable
//      transcript. Now: the post-call webhook extracts from the
//      transcript in its own payload.
//
// NOT covered: the live deployment, the live Neon store, real OpenAI /
// ElevenLabs calls (all seamed), enforced tenant mode (compat mode is
// the live shape; the handlers' tenant branches follow the same
// resolveHandlerTenant contract the tenant-wiring suite pins).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/memory-fix-handler-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  return JSON.parse(line);
}

const out = runChild();

test('recall: a working search returns the matching fact first and says mode=vector', () => {
  const r = out.recallVector;
  assert.equal(r.code, 200);
  assert.equal(r.found, true);
  assert.equal(r.mode, 'vector');
  assert.equal(r.firstKey, 'Printful tumbler costs', 'the stored row the query names word-for-word must win');
  assert.equal(r.limitUsed, 8, 'recall limit is 8 now, not the old hardcoded 5');
  assert.ok(Array.isArray(r.kinds) && r.kinds.includes('identity'), 'rows carry kind for briefing grouping');
});

test('recall: a dead embed path is VISIBLE as boot-fallback, never silent', () => {
  const r = out.recallFallback;
  assert.equal(r.code, 200);
  assert.equal(r.mode, 'boot-fallback');
  assert.equal(r.firstKey, 'User name', 'fallback rows are the boot-ranked head — exactly what production served for every query');
  assert.equal(out.bootMode.mode, 'boot', 'no-query retrieval reports boot mode');
});

test('checkpoint: memories are saved MID-session from the captured turns', () => {
  const r = out.checkpointMidSession;
  assert.equal(r.code, 200);
  assert.equal(r.extracted, 1);
  assert.equal(r.inserted, 1);
  assert.equal(r.newTurns, 6);
  assert.equal(r.cursorTurn, 5);
  assert.equal(r.rowSaved, true, 'the fact landed in memory_items while the call was still running');
  assert.equal(r.rowSource, 'conv_test_1', 'provenance is the conversation id');
  assert.equal(r.rowUser, 'troy');
});

test('checkpoint: cursor makes repeat fires and small slices safe', () => {
  assert.equal(out.checkpointNoNew.reason, 'no new turns');
  assert.equal(out.checkpointNoNew.cursorTurn, 5);
  assert.equal(out.checkpointBelowThreshold.reason, 'below checkpoint threshold');
  assert.equal(out.checkpointBelowThreshold.pendingTurns, 2);
  assert.equal(out.checkpointBelowThreshold.cursorTurn, 5, 'below-threshold fire does not consume the slice');
});

test('checkpoint: the forced flush (drop-off / pagehide) lands the tail', () => {
  const r = out.checkpointForcedFlush;
  assert.equal(r.code, 200);
  assert.equal(r.newTurns, 2, 'the below-threshold tail was processed because the flush was forced');
  assert.equal(r.cursorTurn, 7);
});

test('checkpoint: when extraction cannot run, the cursor holds and the retry lands', () => {
  assert.match(out.checkpointNoLlm.reason, /no-llm/);
  assert.equal(out.checkpointNoLlm.cursorHeld, true, 'a skipped extraction must not consume the slice');
  assert.equal(out.checkpointRetry.extracted, 1);
  assert.equal(out.checkpointRetry.rowSaved, true);
  assert.equal(out.checkpointRetry.cursorTurn, 4);
});

test('webhook: the post-call webhook saves memories from its own transcript', () => {
  const r = out.webhookExtract;
  assert.equal(r.code, 200);
  assert.equal(r.reconciled, true);
  assert.equal(r.turns, 3);
  assert.equal(r.memoryExtracted, 1, 'extraction ran server-side with no client fire and no transcript re-fetch');
  assert.equal(r.rowSaved, true);
});
