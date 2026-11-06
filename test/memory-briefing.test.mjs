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

import { buildSystemPrompt, renderMemoriesByKind, RECALL_BEFORE_IGNORANCE } from '../lib/personality.js';
import { turnsToTranscript, selectNewTurns, CHECKPOINT_MIN_NEW_TURNS } from '../server/handlers/checkpoint-memories.js';
import { mergeBootFacts, recentSlotCount, lexicalPinPattern } from '../server/handlers/memory.js';
import { formatRecallSummary } from '../server/handlers/recall-memory.js';

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
  for (const [key, v] of [['k1', 'FACT_VALUE'], ['k2', 'IDENTITY_VALUE'], ['k3', 'PROJECT_VALUE'], ['k4', 'DECISION_VALUE'], ['k5', 'PREFERENCE_VALUE']]) {
    assert.ok(prompt.includes(`- ${key}: ${v}`), `named bullet preserved: ${v}`);
  }
  // Identity leads the briefing, ahead of plain facts.
  assert.ok(prompt.indexOf('IDENTITY_VALUE') < prompt.indexOf('FACT_VALUE'));
});

test('briefing: kind-less memories stay a flat list and keep the fact name', () => {
  const rendered = renderMemoriesByKind([
    { key: 'a', value: 'one' },
    { key: 'b', value: 'two' },
  ]);
  assert.equal(rendered, '- a: one\n- b: two');
  const prompt = buildSystemPrompt({ memories: [{ key: 'Capstone Canary code', value: 'BlueSky42' }] });
  assert.ok(prompt.includes('- Capstone Canary code: BlueSky42'), 'a code is named, not a bare value');
  assert.ok(!prompt.includes('Who they are'), 'no group scaffolding for legacy rows');
  // A row with no separate name still renders as the value alone.
  assert.equal(renderMemoriesByKind([{ value: 'just this' }]), '- just this');
  assert.equal(renderMemoriesByKind([{ key: 'same', value: 'same' }]), '- same');
});

test('briefing: the widget prompt requires recall_memory before claiming ignorance', () => {
  const prompt = buildSystemPrompt({
    userName: 'Troy',
    memories: [{ key: 'Capstone Canary code', value: 'BlueSky42' }],
  });
  assert.ok(prompt.includes(RECALL_BEFORE_IGNORANCE));
  assert.ok(prompt.includes('recall_memory'), 'the tool is named in the session override');
  assert.ok(prompt.includes('MUST call recall_memory'));
  assert.ok(prompt.includes('Capstone Canary code: BlueSky42'));
  // The lookup rule is in force, and the guardrails still come after it
  // so they win a conflict.
  assert.ok(prompt.indexOf('MUST call recall_memory') < prompt.indexOf('[SAFETY RULES'));
  // Desktop text chat does not have the webhook tool, so it must not be
  // told to call it.
  const text = buildSystemPrompt({ includeToolsBlock: false, memories: [] });
  assert.ok(!text.includes('recall_memory'));
});

test('boot brief: a recent canary survives a full importance head', () => {
  const ranked = Array.from({ length: 30 }, (_, i) => ({
    key: `old-${i}`,
    value: `fact-${i}`,
    importance: 1,
  }));
  const canary = { key: 'Capstone Canary code', value: 'BlueSky42', importance: 0.5 };
  const merged = mergeBootFacts(ranked, [canary], 30);
  assert.equal(merged.length, 30);
  assert.ok(merged.some((f) => f.key === 'Capstone Canary code' && f.value === 'BlueSky42'));
  assert.equal(merged[0].value, 'BlueSky42', 'newest reserved rows are not the ones trimmed');
  assert.ok(!merged.some((f) => f.key === 'old-29'), 'the importance tail yields its slot');
  // An importance-1.0 canary already in the ranked head is kept, once.
  const top = { key: 'Capstone Canary code', value: 'BlueSky42', importance: 1 };
  const rankedWithCanary = [top, ...ranked.slice(0, 29)];
  const again = mergeBootFacts(rankedWithCanary, [top], 30);
  assert.equal(again.filter((f) => f.value === 'BlueSky42').length, 1);
  assert.equal(recentSlotCount(30), 8);
  assert.equal(lexicalPinPattern('Capstone canary code'), '%Capstone canary code%');
  assert.equal(lexicalPinPattern('a'), null);
  assert.equal(lexicalPinPattern('%_%'), null);
});

test('recall summary names the fact, not only the value', () => {
  assert.equal(
    formatRecallSummary([{ key: 'Capstone Canary code', value: 'BlueSky42' }]),
    'Capstone Canary code: BlueSky42',
  );
});

test('briefing: unknown kinds fall into the catch-all group, never dropped', () => {
  const rendered = renderMemoriesByKind([
    { key: 'a', value: 'known', kind: 'identity' },
    { key: 'b', value: 'mystery', kind: 'something_new' },
    { key: 'c', value: 'kindless' },
  ]);
  assert.ok(rendered.includes('Other things you know'));
  assert.ok(rendered.includes('- b: mystery'));
  assert.ok(rendered.includes('- c: kindless'));
  assert.ok(rendered.includes('- a: known'));
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
  // Hang up → next call: the cached brief is refreshed, and every new
  // call still sends the prompt override plus the tenant user_id.
  const hangup = html.slice(html.indexOf('function cfNoteHangup'), html.indexOf('function cfWidgetEndClick'));
  assert.ok(hangup.includes('reprimeSessionPrompt()'), 'hangup re-primes so the next call sees facts saved on this one');
  const call = html.slice(html.indexOf("document.addEventListener('elevenlabs-convai:call'"), html.indexOf('const userOnConnect = cfg.onConnect'));
  assert.ok(call.includes('prompt: promptForCall'), 'the per-session override is what the call sends');
  assert.ok(call.includes('user_id: uid'), 'dynamicVariables.user_id is set on the call');
  assert.ok(call.includes('let uid = tbCallUserId()'), 'that user_id is the tenant id when logged in');
});

test('router: /api/checkpoint-memories is registered', () => {
  const router = readFileSync(fileURLToPath(new URL('../api/[...path].js', import.meta.url)), 'utf8');
  assert.ok(router.includes("'checkpoint-memories': () => import('../server/handlers/checkpoint-memories.js')"));
});
