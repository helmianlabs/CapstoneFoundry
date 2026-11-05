// test/memory-briefing.test.mjs — memory-fix bite (2026-11-05).
//
// The session briefing (lib/personality.js buildSystemPrompt) groups
// memories by kind when the rows carry one — who they are / their
// projects / decisions and why / how they like things done — instead of
// one flat importance-ordered blob. Rows without a kind (legacy
// callers) render byte-for-byte as before. Also pins the checkpoint
// handler's pure helpers and the client/router wiring that fires
// during-session autosave.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildSystemPrompt, renderMemoriesByKind } from '../lib/personality.js';
import { turnsToTranscript, selectNewTurns, CHECKPOINT_MIN_NEW_TURNS } from '../server/handlers/checkpoint-memories.js';

test('briefing: kind-carrying memories render grouped by kind', () => {
  const prompt = buildSystemPrompt({
    userName: 'Troy',
    memories: [
      { key: 'k1', value: 'FACT_VALUE', kind: 'fact' },
      { key: 'k2', value: 'IDENTITY_VALUE', kind: 'identity' },
      { key: 'k3', value: 'PROJECT_VALUE', kind: 'project_state' },
      { key: 'k4', value: 'DECISION_VALUE', kind: 'decision' },
      { key: 'k5', value: 'PREFERENCE_VALUE', kind: 'preference' },
    ],
  });
  for (const label of ['Who they are', 'Their projects', 'Decisions they have made', 'How they like things done', 'Facts']) {
    assert.ok(prompt.includes(label), `group label present: ${label}`);
  }
  for (const v of ['FACT_VALUE', 'IDENTITY_VALUE', 'PROJECT_VALUE', 'DECISION_VALUE', 'PREFERENCE_VALUE']) {
    assert.ok(prompt.includes(`- ${v}`), `bullet preserved: ${v}`);
  }
  // Identity leads the briefing, ahead of plain facts.
  assert.ok(prompt.indexOf('IDENTITY_VALUE') < prompt.indexOf('FACT_VALUE'));
});

test('briefing: kind-less memories render as the original flat list', () => {
  const rendered = renderMemoriesByKind([
    { key: 'a', value: 'one' },
    { key: 'b', value: 'two' },
  ]);
  assert.equal(rendered, '- one\n- two');
  const prompt = buildSystemPrompt({ memories: [{ key: 'a', value: 'just this' }] });
  assert.ok(prompt.includes('- just this'));
  assert.ok(!prompt.includes('Who they are'), 'no group scaffolding for legacy rows');
});

test('briefing: unknown kinds fall into the catch-all group, never dropped', () => {
  const rendered = renderMemoriesByKind([
    { key: 'a', value: 'known', kind: 'identity' },
    { key: 'b', value: 'mystery', kind: 'something_new' },
    { key: 'c', value: 'kindless' },
  ]);
  assert.ok(rendered.includes('Other things you know'));
  assert.ok(rendered.includes('- mystery'));
  assert.ok(rendered.includes('- kindless'));
});

test('checkpoint helpers: turns become an extractor transcript, empties dropped', () => {
  const transcript = turnsToTranscript([
    { turn_index: 0, role: 'user', content: 'hello' },
    { turn_index: 1, role: 'agent', content: '   ' },
    { turn_index: 2, role: 'agent', content: 'hi there' },
    { turn_index: 3, role: 'system', content: 'odd role still counts as agent side' },
  ]);
  assert.deepEqual(transcript, [
    { role: 'user', message: 'hello' },
    { role: 'agent', message: 'hi there' },
    { role: 'agent', message: 'odd role still counts as agent side' },
  ]);
});

test('checkpoint helpers: only turns past the cursor are selected', () => {
  const rows = [0, 1, 2, 3, 4].map((i) => ({ turn_index: i, role: 'user', content: `t${i}` }));
  assert.deepEqual(selectNewTurns(rows, 2).map((r) => r.turn_index), [3, 4]);
  assert.deepEqual(selectNewTurns(rows, -1).map((r) => r.turn_index), [0, 1, 2, 3, 4]);
  assert.deepEqual(selectNewTurns(rows, 4), []);
  assert.ok(CHECKPOINT_MIN_NEW_TURNS >= 1);
});

test('client wiring: index.html fires during-session checkpoints', () => {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  assert.ok(html.includes("fetch('/api/checkpoint-memories'"), 'checkpoint endpoint is called');
  assert.ok(html.includes('function fireMemoryCheckpoint(force)'), 'checkpoint driver exists');
  assert.ok(html.includes('CHECKPOINT_EVERY_TURNS'), 'per-N-turns trigger exists');
  assert.ok(html.includes('startCheckpointTimer()'), 'interval trigger starts with the call');
  // The drop-off paths force a flush: disconnect and pagehide teardown.
  assert.ok(html.includes("fireMemoryCheckpoint(true);\n        fireExtractMemories('disconnect')"), 'disconnect forces a checkpoint before the end extract');
  assert.ok(html.includes("fireMemoryCheckpoint(true);\n      fireExtractMemories('pagehide')"), 'pagehide forces a checkpoint before the end extract');
  // A skipped/failed checkpoint must not advance the client cursor.
  assert.ok(html.includes('lastCheckpointTurn = Math.max(lastCheckpointTurn, d.cursorTurn + 1)'), 'client cursor advances only on the server response');
});

test('router: /api/checkpoint-memories is registered', () => {
  const router = readFileSync(fileURLToPath(new URL('../api/[...path].js', import.meta.url)), 'utf8');
  assert.ok(router.includes("'checkpoint-memories': () => import('../server/handlers/checkpoint-memories.js')"));
});
