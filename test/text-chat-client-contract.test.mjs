// test/text-chat-client-contract.test.mjs — safety wiring bite 6
// (safety-gap-map §7): the text-chat client contract.
//
// The gap, per the map (§1.4): desktop.html posted only { messages }
// to a HARD-CODED older deployment's /api/chat with no account
// session, so the profile-aware chat handler could never load the
// caller's profile from it; index.html's browser-voice fallback
// posted to CONFIG.apiEndpoint, an object defined NOWHERE in the
// shipped client, so no request from that function could be traced
// to /api/chat at all. This file pins the repaired contract:
//
//   - both surfaces POST to the deployment's own same-origin
//     /api/chat, carrying the account session exactly when a token
//     is stored (the server resolves safety from the profile that
//     session names — bites 1-2's resolver — never from the body);
//   - the bodies carry messages (+ userContext on the index
//     surface, as the server contract defines) and NO safety fields
//     anywhere — a text client cannot reach a less-safe
//     configuration than the voice path allows for the same profile;
//   - the server's two refusal shapes are consumed as sent:
//     reply-shaped refusals ({ reply }: moderation refusals and the
//     handler's own failure messages) are the buddy's turn, spoken
//     and kept in history; error-shaped refusals ({ error }: 401
//     Unauthorized, 402 credits_exhausted, ...) are NOT buddy
//     speech — they take the connection-error path and never enter
//     the history as an assistant turn;
//   - neither surface caches a prime/prompt: every message is a
//     fresh /api/chat request, so a profile change is decided by
//     the server on the very next message — there is no stale text
//     prime to withhold (the text-path analogue of bite 5's voice
//     lifecycle, pinned by the two-message tests below);
//   - server side, an INCOMPLETE profile (age_band NULL) gets the
//     fail-closed decision over text chat, proven against the real
//     handler in the child fixture.
//
// Method (house client-test pattern): the real client code runs
// under node:vm with fetch stubbed at the seam; the chat-handler
// scenarios run in a child process with module mocks (see
// test/fixtures/text-chat-safety-child.mjs). No live calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const desktopHtml = readFileSync(new URL('../desktop.html', import.meta.url), 'utf8');
const chatHandlerSrc = readFileSync(new URL('../server/handlers/chat.js', import.meta.url), 'utf8');

function sliceBetween(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after: ${startMarker}`);
  return src.slice(a, b + endMarker.length);
}

function sliceExclusive(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after: ${startMarker}`);
  return src.slice(a, b);
}

const resp = (payload, { ok = true, status = 200 } = {}) => ({
  ok, status, json: async () => payload,
});

function assertNoSafetyFields(bodyJson, label) {
  for (const field of ['"safetyMode"', '"ageBand"', '"safety_mode"', '"age_band"']) {
    assert.ok(!bodyJson.includes(field), `${label}: body must not carry ${field}`);
  }
}

// ─── index.html browser-voice fallback (sendToThinkinBuddy) ────────

function makeIndexHarness() {
  const store = new Map();
  const fetches = [];
  const responses = [];
  const spoken = [];
  const sandbox = {
    console,
    currentUser: { userId: 'troy', name: 'Troy', notes: [], firstVisit: false },
    currentHistory: [],
    sessionActive: false,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    loadKeys: () => ({}),
    loadBrain: () => 'auto',
    loadBrainModel: () => null,
    fetch: (url, opts) => {
      fetches.push({ url, opts });
      const next = responses.shift();
      assert.ok(next, 'index harness: a fetch happened with no queued response');
      return Promise.resolve(next);
    },
    setStatus: () => {},
    transcriptEl: { textContent: '' },
    saveHistory: () => {},
    relaySend: () => {},
    handleActions: () => {},
    speak: (text, cb) => { spoken.push(text); if (cb) cb(); },
    startListening: () => {},
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  // The real session helpers + the real apiFetch (earlier script
  // blocks in index.html; one shared window scope in the browser),
  // then the fallback itself.
  vm.runInContext(sliceBetween(indexHtml, 'function tbSessionToken', '// Poll for newly generated images'), sandbox);
  vm.runInContext(sliceBetween(indexHtml, 'const TEXT_BRAIN_KEYS', 'window.thinkinBuddyApiFetch = apiFetch;'), sandbox);
  vm.runInContext(sliceExclusive(indexHtml, 'async function sendToThinkinBuddy', 'recognition.onstart'), sandbox);
  return { store, fetches, responses, spoken, sandbox };
}

const historyPairs = (sandbox) => sandbox.currentHistory.map((m) => [m.role, m.content]);

test('index fallback: same-origin /api/chat, session attached when a token exists, server-contract body, no safety fields', async () => {
  const h = makeIndexHarness();
  h.store.set('tb_token', 'tok-abc');
  h.responses.push(resp({ reply: 'A friendly reply about frogs.' }));

  await h.sandbox.sendToThinkinBuddy('tell me about frogs');

  assert.equal(h.fetches.length, 1);
  const { url, opts } = h.fetches[0];
  assert.equal(url, '/api/chat', 'same-origin chat path on the serving deployment');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.Authorization, 'Bearer tok-abc', 'apiFetch attaches the account session');
  assert.equal(opts.headers['Content-Type'], 'application/json');
  const body = JSON.parse(opts.body);
  assert.deepEqual(Object.keys(body).sort(), ['messages', 'userContext']);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'tell me about frogs' }]);
  assert.deepEqual(body.userContext, { userId: 'troy', name: 'Troy', notes: [], firstVisit: false });
  assertNoSafetyFields(opts.body, 'index fallback');
  // The reply-shaped response is the buddy's turn: spoken and kept.
  assert.deepEqual(h.spoken, ['A friendly reply about frogs.']);
  assert.deepEqual(historyPairs(h.sandbox), [
    ['user', 'tell me about frogs'],
    ['assistant', 'A friendly reply about frogs.'],
  ]);
});

test('index fallback: no token -> no Authorization; an error-shaped 401 is not buddy speech and enters no history', async () => {
  const h = makeIndexHarness();
  h.responses.push(resp({ error: 'Unauthorized' }, { ok: false, status: 401 }));

  await h.sandbox.sendToThinkinBuddy('hello');

  assert.equal(h.fetches.length, 1);
  assert.ok(!('Authorization' in (h.fetches[0].opts.headers || {})), 'no Authorization header without a token');
  assert.deepEqual(h.spoken, ['Connection error.'], 'error-shaped refusal takes the connection-error path');
  assert.deepEqual(historyPairs(h.sandbox), [['user', 'hello']], 'no assistant turn was invented from the refusal');
});

test('index fallback: no cached prime — a profile change is decided by the server on the very next message', async () => {
  const h = makeIndexHarness();
  h.store.set('tb_token', 'tok-abc');
  // First message: the profile as it stands (completed adult) lets
  // the chat through. Then the profile changes (safety on /
  // incomplete): the NEXT message's treatment is whatever the
  // server resolves at that moment — here its fail-closed refusal
  // shape. The client holds no prime to go stale: it re-asks.
  h.responses.push(resp({ reply: 'An adult answer.' }));
  h.responses.push(resp({ reply: "Let's keep it friendly — I'm not going there. What else is on your mind?" }));

  await h.sandbox.sendToThinkinBuddy('first question');
  await h.sandbox.sendToThinkinBuddy('second question');

  assert.equal(h.fetches.length, 2, 'every message is a fresh /api/chat request — nothing is cached');
  assert.equal(h.fetches[1].url, '/api/chat');
  assert.deepEqual(h.spoken, [
    'An adult answer.',
    "Let's keep it friendly — I'm not going there. What else is on your mind?",
  ]);
  const sendSrc = sliceExclusive(indexHtml, 'async function sendToThinkinBuddy', 'recognition.onstart');
  assert.ok(!sendSrc.includes('sessionPromptOverride'), 'the text path holds no primed prompt');
  assert.ok(!sendSrc.includes('currentSessionPrompt'), 'the text path holds no prompt cache of any kind');
});

// ─── desktop.html ──────────────────────────────────────────────────

function makeDesktopHarness() {
  const store = new Map();
  const fetches = [];
  const responses = [];
  const spoken = [];
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) {
      elements.set(id, { textContent: '', className: '', addEventListener: () => {} });
    }
    return elements.get(id);
  };
  class FakeRecognition {
    constructor() { this.continuous = false; }
    start() {}
    stop() {}
  }
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const sandbox = {
    console,
    document: { getElementById: el },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    SpeechRecognition: FakeRecognition,
    SpeechSynthesisUtterance: FakeUtterance,
    speechSynthesis: {
      getVoices: () => [],
      cancel: () => {},
      speak: (u) => { spoken.push(u.text); if (u.onend) u.onend(); },
    },
    fetch: (url, opts) => {
      fetches.push({ url, opts });
      const next = responses.shift();
      assert.ok(next, 'desktop harness: a fetch happened with no queued response');
      return Promise.resolve(next);
    },
    setTimeout: () => 0,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const script = sliceBetween(desktopHtml, '<script>', '</script>')
    .replace(/^<script>/, '').replace(/<\/script>$/, '');
  vm.runInContext(script, sandbox);
  return { store, fetches, responses, spoken, sandbox };
}

test('desktop: same-origin /api/chat, session attached when a token exists, messages-only body, no safety fields', async () => {
  const h = makeDesktopHarness();
  h.store.set('tb_token', 'tok-abc');
  h.responses.push(resp({ reply: 'A friendly reply about frogs.' }));

  await h.sandbox.ask('tell me about frogs');

  assert.equal(h.fetches.length, 1);
  const { url, opts } = h.fetches[0];
  assert.equal(url, '/api/chat', 'the deployment\u2019s own chat path — no hard-coded host');
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.Authorization, 'Bearer tok-abc', 'the account session rides when one is stored');
  assert.equal(opts.headers['Content-Type'], 'application/json');
  const body = JSON.parse(opts.body);
  assert.deepEqual(Object.keys(body), ['messages'], 'desktop sends exactly the server contract\u2019s messages field');
  assert.deepEqual(body.messages, [{ role: 'user', content: 'tell me about frogs' }]);
  assertNoSafetyFields(opts.body, 'desktop');
  assert.deepEqual(h.spoken, ['A friendly reply about frogs.']);
});

test('desktop: no token -> no Authorization; an error-shaped 401 enters no history; the next message re-asks the server', async () => {
  const h = makeDesktopHarness();
  h.responses.push(resp({ error: 'Unauthorized' }, { ok: false, status: 401 }));
  h.responses.push(resp({ reply: "Let's keep it friendly — I'm not going there. What else is on your mind?" }));

  await h.sandbox.ask('first question');
  assert.ok(!('Authorization' in (h.fetches[0].opts.headers || {})), 'no Authorization header without a token');
  assert.deepEqual(h.spoken, ['Connection error.'], 'error-shaped refusal is not spoken as the buddy');

  // The profile is completed / safety state changes between the two
  // messages: the second is a FRESH request whose body proves the
  // 401 invented no assistant turn, and the server's new decision
  // (its refusal shape) is what gets spoken — no cached prime.
  await h.sandbox.ask('second question');
  assert.equal(h.fetches.length, 2);
  const body2 = JSON.parse(h.fetches[1].opts.body);
  assert.deepEqual(body2.messages, [
    { role: 'user', content: 'first question' },
    { role: 'user', content: 'second question' },
  ]);
  assert.deepEqual(h.spoken, [
    'Connection error.',
    "Let's keep it friendly — I'm not going there. What else is on your mind?",
  ]);
});

// ─── Server side: an incomplete profile fails closed over text ─────

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/text-chat-safety-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, ['--experimental-test-module-mocks', child], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}`);
  return JSON.parse(line);
}

test('chat handler: an incomplete profile (age_band NULL) gets the fail-closed decision over text', () => {
  const { incompleteDown, incompleteClean, adultClean } = runChild();

  // Moderation unavailable + fail-closed decision = refusal, and
  // the LLM is never reached. The profile store was consulted —
  // the decision came from the profile path, not the request (the
  // request claimed nothing at all).
  assert.equal(incompleteDown.code, 200);
  assert.match(incompleteDown.reply, /keep it friendly/);
  assert.equal(incompleteDown.llmDelta, 0, 'incomplete profile + moderation down: LLM never called');
  assert.ok(incompleteDown.profileDelta >= 1, 'profile store consulted');

  // Moderation clean: the chat proceeds, but under the fail-closed
  // decision — the kid safety core is in the system prompt.
  assert.equal(incompleteClean.code, 200);
  assert.equal(incompleteClean.llmDelta, 1);
  assert.equal(incompleteClean.kidCore, true, 'incomplete profile -> KID_SAFETY_CORE in the text-chat prompt');
  assert.equal(incompleteClean.baseRules, true);

  // The completed-adult control: same clean path, no kid core.
  assert.equal(adultClean.llmDelta, 1);
  assert.equal(adultClean.kidCore, false, 'completed adult profile, safety off -> no kid core');
});

// ─── Source pins: the broken contract cannot come back ─────────────

test('source: no shipped client depends on CONFIG.apiEndpoint or a hard-coded chat host', () => {
  const publicJs = readdirSync(new URL('../public/', import.meta.url))
    .filter((f) => f.endsWith('.js'))
    .map((f) => [`public/${f}`, readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8')]);
  const shippedClients = [
    ['index.html', indexHtml],
    ['desktop.html', desktopHtml],
    ['script.js', readFileSync(new URL('../script.js', import.meta.url), 'utf8')],
    ['diary.html', readFileSync(new URL('../diary.html', import.meta.url), 'utf8')],
    ...publicJs,
  ];
  for (const [name, src] of shippedClients) {
    assert.ok(!src.includes('CONFIG.apiEndpoint'), `${name}: CONFIG.apiEndpoint is gone`);
    assert.ok(!/https?:\/\/[^\s'"`]+\/api\/chat/.test(src), `${name}: no absolute /api/chat URL`);
  }
  // The repaired shapes, pinned positively:
  assert.ok(desktopHtml.includes("const API = '/api/chat';"), 'desktop uses the same-origin chat path');
  assert.ok(desktopHtml.includes("localStorage.getItem('tb_token')"), 'desktop reads the onboarding session key');
  const sendSrc = sliceExclusive(indexHtml, 'async function sendToThinkinBuddy', 'recognition.onstart');
  assert.ok(sendSrc.includes("apiFetch('/api/chat'"), 'the index fallback calls chat through apiFetch');
  assert.ok(!sendSrc.includes('CONFIG'), 'the index fallback names no CONFIG object');
  // Server side (bite 1's half of this bite's file list): enforced
  // chat still rejects a request with no resolvable tenant before
  // any LLM call — pinned here so bite 6's contract keeps both ends.
  assert.ok(chatHandlerSrc.includes("if (!chatTenantId) return res.status(401).json({ error: 'Unauthorized' });"));
});
