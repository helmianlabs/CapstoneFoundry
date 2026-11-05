// test/fixtures/memory-fix-handler-child.mjs — NOT a test file (no
// .test.mjs suffix): a child process driven by test/memory-handlers.test.mjs
// with `node --experimental-test-module-mocks` (same pattern as
// test/fixtures/prime-safety-handler-child.mjs).
//
// It runs the REAL handlers — recall-memory, checkpoint-memories,
// api/conversation-webhook — and the REAL memory.js retrieval /
// saveMemoryCandidates pipeline, with exactly three seams faked:
//   - pg Pool.prototype.query/connect -> an in-memory emulator over
//     seeded memory_items / conversation_sessions / conversation_turns /
//     memory_extract_cursors, applying the SQL's actual predicates.
//   - the 'openai' module -> a deterministic embedder (content-marker
//     vectors), switchable to throwing, which is how production behaved
//     when OPENAI_API_KEY had no Production target.
//   - lib/llm.js -> a canned extraction LLM (completeText returns a
//     scenario-set JSON candidate array; hasTextLlm switchable).
//
// Compat tenant mode throughout (no SESSION_SECRET — today's live
// deployment shape). Output: one JSON line on stdout.
import { mock } from 'node:test';

process.env.DATABASE_URL_MEMORY = 'postgres://fake.invalid/thinkinbuddy_memory';
process.env.OPENAI_API_KEY = '<redacted>';
delete process.env.SESSION_SECRET;
process.env.ELEVENLABS_POSTCALL_WEBHOOK_SECRET = 'whsec_test_secret';

// ─── Fake embedder ────────────────────────────────────────────────────
// Marker vectors in 3-d so cosine outcomes are exact and controllable:
//   tumblers -> [0,1,0]; Bandit -> [1,1,0]; Boise -> [1,0,1]. Every
//   marker vector's cosine against every seeded row AND against the
//   other marker vectors is <= 0.707 — below the 0.75 judge band — so
//   extraction candidates always take the fresh-insert path (two
//   distinct facts must never collide into a >=0.92 merge).
//   Anything else -> [0,0,1].
globalThis.__embedMode = 'ok';
function vecFor(text) {
  const t = String(text || '');
  if (/tumbler/i.test(t)) return [0, 1, 0];
  if (/bandit/i.test(t)) return [1, 1, 0];
  if (/boise/i.test(t)) return [1, 0, 1];
  if (/user'?s name|MARKER_NAME/i.test(t)) return [1, 0, 0];
  return [0, 0, 1];
}
class FakeOpenAI {
  constructor() {
    this.embeddings = {
      create: async ({ input }) => {
        if (globalThis.__embedMode === 'fail') throw new Error('OPENAI_API_KEY not set');
        return { data: [{ embedding: vecFor(input) }] };
      },
    };
  }
}
mock.module('openai', { cache: false, defaultExport: FakeOpenAI });

// ─── Fake text LLM (extraction + contradiction judge surface) ────────
globalThis.__hasLlm = true;
globalThis.__extractResponse = '[]';
mock.module('../../lib/llm.js', {
  cache: false,
  exports: {
    completeText: async () => globalThis.__extractResponse,
    hasTextLlm: () => globalThis.__hasLlm === true,
    DEFAULT_MODELS: { gemini: 'fake', openai: 'fake', anthropic: 'fake', xai: 'fake' },
    preferredBrain: () => 'gemini',
    preferredModel: () => 'fake',
    keyForProvider: () => ({ key: 'fake', source: 'env' }),
    geminiKey: () => 'fake',
    anthropicKey: () => 'fake',
    duckDuckGoSearch: async () => [],
    parseDuckDuckGoHtml: () => [],
  },
});

// ─── In-memory DB emulator (pg Pool seam) ────────────────────────────
const db = {
  memory: [
    { id: 'm1', user_id: 'troy', tenant_id: null, scope: 'semantic', kind: 'identity', subject: 'User name', content: "The user's name is Troy.", embedding: [1, 0, 0], confidence: 0.9, importance: 0.99, valid_until: null, supersedes: null, source_session: 'seed', created_at: new Date('2026-10-23T21:03:00Z'), updated_at: new Date('2026-10-23T21:03:00Z') },
    { id: 'm2', user_id: 'troy', tenant_id: null, scope: 'semantic', kind: 'fact', subject: 'Printful tumbler costs', content: 'Tumbler base cost is twelve dollars.', embedding: [0, 1, 0], confidence: 0.7, importance: 0.30, valid_until: null, supersedes: null, source_session: 'seed', created_at: new Date('2026-10-23T21:03:00Z'), updated_at: new Date('2026-10-23T21:03:00Z') },
    { id: 'm3', user_id: 'troy', tenant_id: null, scope: 'semantic', kind: 'project_state', subject: 'Deployment stack', content: 'The app deploys on Vercel with Neon.', embedding: [0, 0, 1], confidence: 0.8, importance: 0.85, valid_until: null, supersedes: null, source_session: 'seed', created_at: new Date('2026-10-23T20:58:00Z'), updated_at: new Date('2026-10-23T20:58:00Z') },
  ],
  sessions: [],
  turns: [],
  cursors: new Map(),
  lastRecallLimit: null,
  seq: 100,
};
const newId = () => `row-${++db.seq}`;

function cosine(a, b) {
  if (!a || !b) return 0;
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / (Math.sqrt(na) * Math.sqrt(nb)) : 0;
}
function parseVecLit(lit) {
  try { return JSON.parse(String(lit)); } catch { return null; }
}
const live = (r) => r.valid_until == null || new Date(r.valid_until) > new Date();

const { Pool } = await import('pg');
Pool.prototype.query = function patchedQuery(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();

  if (/CREATE TABLE IF NOT EXISTS memory_extract_cursors/i.test(s)) return Promise.resolve({ rows: [], rowCount: 0 });

  if (/FROM memory_extract_cursors/i.test(s)) {
    const cur = db.cursors.get(params[0]);
    return Promise.resolve({ rows: cur ? [{ last_turn_index: cur }] : [], rowCount: cur ? 1 : 0 });
  }
  if (/INSERT INTO memory_extract_cursors/i.test(s)) {
    const [sid, , idx] = params;
    const prev = db.cursors.get(sid);
    db.cursors.set(sid, prev == null ? idx : Math.max(prev, idx));
    return Promise.resolve({ rows: [], rowCount: 1 });
  }

  if (/FROM conversation_sessions/i.test(s)) {
    let row = null;
    if (/WHERE conversation_id = \$1/.test(s)) row = db.sessions.find((x) => x.conversation_id === params[0]) || null;
    else if (/WHERE id = \$1/.test(s)) row = db.sessions.find((x) => x.id === params[0]) || null;
    return Promise.resolve({ rows: row ? [{ id: row.id, user_id: row.user_id, conversation_id: row.conversation_id, tenant_id: row.tenant_id }] : [], rowCount: row ? 1 : 0 });
  }
  if (/INSERT INTO conversation_sessions/i.test(s)) {
    db.sessions.push({ id: params[0], user_id: params[1], conversation_id: params[2], agent_id: params[3], tenant_id: null });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  if (/UPDATE conversation_sessions/i.test(s)) return Promise.resolve({ rows: [], rowCount: 1 });

  if (/FROM conversation_turns/i.test(s)) {
    const sid = params[0];
    const after = params[params.length - 1];
    const rows = db.turns
      .filter((t) => t.session_id === sid && t.turn_index > after)
      .sort((a, b) => a.turn_index - b.turn_index)
      .map((t) => ({ turn_index: t.turn_index, role: t.role, content: t.content }));
    return Promise.resolve({ rows, rowCount: rows.length });
  }
  if (/INSERT INTO conversation_turns/i.test(s)) {
    db.turns.push({ session_id: params[0], turn_index: params[1], role: params[2], content: params[3] });
    return Promise.resolve({ rows: [], rowCount: 1 });
  }

  // saveMemoryCandidates neighbor search: carries "AS distance".
  if (/FROM memory_items/i.test(s) && /AS distance/i.test(s)) {
    const qv = parseVecLit(params[0]);
    const uid = params[1];
    const scope = params[2];
    const limit = params[params.length - 1];
    const rows = db.memory
      .filter((r) => r.user_id === uid && r.scope === scope && r.embedding && live(r))
      .map((r) => ({ id: r.id, kind: r.kind, subject: r.subject, content: r.content, confidence: r.confidence, importance: r.importance, distance: 1 - cosine(qv, r.embedding) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  // retrieveMemories vector path.
  if (/FROM memory_items/i.test(s) && /<=>/.test(s)) {
    const uid = params[0];
    const scopes = params[1];
    const qv = parseVecLit(params[2]);
    const limit = params[3];
    db.lastRecallLimit = limit;
    const rows = db.memory
      .filter((r) => r.user_id === uid && scopes.includes(r.scope) && live(r))
      .map((r) => ({ r, d: r.embedding ? 1 - cosine(qv, r.embedding) : null }))
      .sort((a, b) => (a.d == null ? Infinity : a.d) - (b.d == null ? Infinity : b.d) || (b.r.importance - a.r.importance))
      .slice(0, limit)
      .map(({ r }) => ({ key: r.subject, value: r.content, kind: r.kind, scope: r.scope, importance: r.importance, updated_at: r.updated_at }));
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  // retrieveMemories boot path.
  if (/FROM memory_items/i.test(s)) {
    const uid = params[0];
    const scopes = params[1];
    const limit = params[params.length - 1];
    db.lastRecallLimit = limit;
    const rows = db.memory
      .filter((r) => r.user_id === uid && scopes.includes(r.scope) && live(r))
      .sort((a, b) => (b.importance - a.importance) || (b.confidence - a.confidence) || (b.updated_at - a.updated_at))
      .slice(0, limit)
      .map((r) => ({ key: r.subject, value: r.content, kind: r.kind, scope: r.scope, importance: r.importance, updated_at: r.updated_at }));
    return Promise.resolve({ rows, rowCount: rows.length });
  }

  // MERGE update in saveMemoryCandidates.
  if (/UPDATE memory_items/i.test(s) && /SET content/i.test(s)) {
    const idM = s.match(/WHERE id = \$(\d+)/);
    const row = db.memory.find((r) => r.id === params[Number(idM[1]) - 1]);
    if (row) {
      row.content = params[0];
      row.embedding = parseVecLit(params[1]);
      row.confidence = Math.max(row.confidence, params[2]);
      row.importance = Math.max(row.importance, params[3]);
    }
    return Promise.resolve({ rows: [], rowCount: row ? 1 : 0 });
  }

  if (/INSERT INTO memory_items/i.test(s)) {
    const colsM = s.match(/INSERT INTO memory_items \(([^)]+)\)/i);
    const cols = colsM[1].split(',').map((c) => c.trim());
    const valsM = s.match(/VALUES \(([\s\S]*)\)\s*(RETURNING id)?\s*$/i);
    // Split the VALUES list on top-level commas only (int4range($a,$b)
    // and vector literals contain commas of their own).
    const tokens = [];
    {
      let depth = 0, cur = '';
      for (const ch of valsM[1]) {
        if (ch === '(' || ch === '[') depth++;
        if (ch === ')' || ch === ']') depth--;
        if (ch === ',' && depth === 0) { tokens.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      if (cur.trim()) tokens.push(cur.trim());
    }
    const row = { id: newId(), tenant_id: null, valid_until: null, supersedes: null, created_at: new Date(), updated_at: new Date() };
    tokens.forEach((tok, i) => {
      const col = cols[i];
      if (!col) return;
      const pm = tok.match(/^\$(\d+)(::vector)?$/);
      if (pm) {
        const v = params[Number(pm[1]) - 1];
        row[col] = col === 'embedding' ? parseVecLit(v) : v;
      } else if (/^int4range/i.test(tok)) {
        row[col] = null;
      } else if (/^'([^']*)'$/.test(tok)) {
        row[col] = tok.slice(1, -1);
      } else if (/^NULL$/i.test(tok)) {
        row[col] = null;
      } else if (/^-?[\d.]+$/.test(tok)) {
        row[col] = Number(tok);
      }
    });
    db.memory.push(row);
    return Promise.resolve({ rows: /RETURNING id/i.test(s) ? [{ id: row.id }] : [], rowCount: 1 });
  }

  throw new Error(`memory-fix fixture: unhandled SQL: ${s.slice(0, 160)}`);
};
Pool.prototype.connect = async function patchedConnect() {
  throw new Error('memory-fix fixture: pool.connect not emulated (supersede path must not trigger in these scenarios)');
};

// ─── Handler imports (after the seams are in place) ──────────────────
const { retrieveMemoriesWithMeta } = await import('../../server/handlers/memory.js');
const recallHandler = (await import('../../server/handlers/recall-memory.js')).default;
const checkpointHandler = (await import('../../server/handlers/checkpoint-memories.js')).default;
const webhookHandler = (await import('../../api/conversation-webhook.js')).default;
const crypto = await import('node:crypto');

function fakeRes() {
  return {
    statusCode: null, body: null,
    setHeader() {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}
async function call(handler, req) {
  const res = fakeRes();
  await handler(req, res);
  return res;
}

const out = {};

// ─── Scenario 1: recall actually searches (vector mode) ──────────────
globalThis.__embedMode = 'ok';
{
  const res = await call(recallHandler, { method: 'POST', headers: {}, body: { userId: 'troy', query: 'Printful tumbler base costs' } });
  out.recallVector = {
    code: res.statusCode, found: res.body?.found, mode: res.body?.mode,
    count: res.body?.count, firstKey: res.body?.facts?.[0]?.key, limitUsed: db.lastRecallLimit,
    kinds: res.body?.facts?.map((f) => f.kind),
  };
}

// ─── Scenario 2: embed failure is VISIBLE (boot-fallback) ────────────
globalThis.__embedMode = 'fail';
{
  const res = await call(recallHandler, { method: 'POST', headers: {}, body: { userId: 'troy', query: 'Printful tumbler base costs' } });
  out.recallFallback = {
    code: res.statusCode, found: res.body?.found, mode: res.body?.mode,
    firstKey: res.body?.facts?.[0]?.key,
  };
  const meta = await retrieveMemoriesWithMeta('troy', { limit: 30 });
  out.bootMode = { mode: meta.mode, firstKey: meta.facts?.[0]?.key };
}
globalThis.__embedMode = 'ok';

// ─── Scenario 3: during-session checkpoint saves MID-session ─────────
const S1 = '11111111-1111-4111-8111-111111111111';
db.sessions.push({ id: S1, user_id: 'troy', conversation_id: 'conv_test_1', tenant_id: null });
db.turns.push(
  { session_id: S1, turn_index: 0, role: 'agent', content: 'Hey, what is on your mind?' },
  { session_id: S1, turn_index: 1, role: 'user', content: 'My dog is named Bandit and he is a border collie.' },
  { session_id: S1, turn_index: 2, role: 'agent', content: 'Bandit, great name.' },
  { session_id: S1, turn_index: 3, role: 'user', content: 'We are moving the launch to December.' },
  { session_id: S1, turn_index: 4, role: 'agent', content: 'Noted.' },
  { session_id: S1, turn_index: 5, role: 'user', content: 'I prefer short plain status updates.' },
);
globalThis.__extractResponse = JSON.stringify([
  { kind: 'fact', subject: 'Dog name', content: "The user's dog is named Bandit.", confidence: 0.9, importance: 0.6, source_span: { start: 1, end: 1 } },
]);
{
  const res = await call(checkpointHandler, { method: 'POST', headers: {}, body: { userId: 'troy', sessionId: S1 } });
  const saved = db.memory.find((r) => r.subject === 'Dog name');
  out.checkpointMidSession = {
    code: res.statusCode, extracted: res.body?.extracted, inserted: res.body?.inserted,
    cursorTurn: res.body?.cursorTurn, newTurns: res.body?.newTurns,
    rowSaved: !!saved, rowSource: saved?.source_session || null, rowUser: saved?.user_id || null,
  };
  // Second fire, nothing new: no double extraction.
  const res2 = await call(checkpointHandler, { method: 'POST', headers: {}, body: { userId: 'troy', sessionId: S1 } });
  out.checkpointNoNew = { reason: res2.body?.reason, cursorTurn: res2.body?.cursorTurn };
  // Two more turns arrive (the call is STILL running), below threshold.
  db.turns.push(
    { session_id: S1, turn_index: 6, role: 'user', content: 'Also, coffee first thing.' },
    { session_id: S1, turn_index: 7, role: 'agent', content: 'Got it.' },
  );
  const res3 = await call(checkpointHandler, { method: 'POST', headers: {}, body: { userId: 'troy', sessionId: S1 } });
  out.checkpointBelowThreshold = { reason: res3.body?.reason, pendingTurns: res3.body?.pendingTurns, cursorTurn: res3.body?.cursorTurn };
  // Simulated drop-off: the pagehide flush is FORCED — the tail lands
  // even though it is below the interval threshold.
  globalThis.__extractResponse = '[]';
  const res4 = await call(checkpointHandler, { method: 'POST', headers: {}, body: { userId: 'troy', sessionId: S1, force: true } });
  out.checkpointForcedFlush = { code: res4.statusCode, cursorTurn: res4.body?.cursorTurn, newTurns: res4.body?.newTurns };
}

// ─── Scenario 4: no LLM -> cursor does NOT advance; retry lands ──────
const S3 = '33333333-3333-4333-8333-333333333333';
db.sessions.push({ id: S3, user_id: 'troy', conversation_id: 'conv_test_3', tenant_id: null });
for (let i = 0; i < 5; i++) {
  db.turns.push({ session_id: S3, turn_index: i, role: i % 2 ? 'agent' : 'user', content: i === 0 ? 'I keep a mailing address in Boise now.' : `turn ${i}` });
}
globalThis.__hasLlm = false;
{
  const res = await call(checkpointHandler, { method: 'POST', headers: {}, body: { userId: 'troy', sessionId: S3 } });
  out.checkpointNoLlm = { reason: res.body?.reason, cursorTurn: res.body?.cursorTurn, cursorHeld: (db.cursors.get(S3) ?? -1) === -1 };
}
globalThis.__hasLlm = true;
globalThis.__extractResponse = JSON.stringify([
  { kind: 'fact', subject: 'Mailing city', content: 'The user keeps a mailing address in Boise.', confidence: 0.8, importance: 0.5, source_span: { start: 0, end: 0 } },
]);
{
  const res = await call(checkpointHandler, { method: 'POST', headers: {}, body: { userId: 'troy', sessionId: S3 } });
  out.checkpointRetry = { extracted: res.body?.extracted, cursorTurn: res.body?.cursorTurn, rowSaved: db.memory.some((r) => r.subject === 'Mailing city') };
}

// ─── Scenario 5: post-call webhook extracts from its own transcript ──
globalThis.__extractResponse = JSON.stringify([
  { kind: 'fact', subject: 'Dog name', content: "The user's dog is named Bandit.", confidence: 0.9, importance: 0.6, source_span: { start: 0, end: 0 } },
]);
{
  // Remove the checkpoint-saved dog row so the webhook's own save is
  // what the assertion measures.
  db.memory = db.memory.filter((r) => !(r.subject === 'Dog name' && r.source_session === 'conv_test_1'));
  const payload = {
    type: 'post_call_transcription',
    data: {
      conversation_id: 'conv_wh_1',
      agent_id: 'agent_test',
      transcript: [
        { role: 'user', message: 'My dog is named Bandit.' },
        { role: 'agent', message: 'Lovely name.' },
        { role: 'user', message: 'He is a border collie.' },
      ],
      conversation_initiation_client_data: { dynamic_variables: { user_id: 'troy' } },
    },
  };
  const rawBody = Buffer.from(JSON.stringify(payload));
  const t = Math.floor(Date.now() / 1000);
  const v0 = crypto.createHmac('sha256', 'whsec_test_secret').update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  const req = {
    method: 'POST',
    headers: { 'elevenlabs-signature': `t=${t},v0=${v0}` },
    async *[Symbol.asyncIterator]() { yield rawBody; },
  };
  const res = await call(webhookHandler, req);
  const saved = db.memory.find((r) => r.subject === 'Dog name' && r.source_session === 'conv_wh_1');
  out.webhookExtract = {
    code: res.statusCode, reconciled: res.body?.reconciled, turns: res.body?.turns,
    memoryExtracted: res.body?.memory?.extracted ?? null, rowSaved: !!saved,
  };
}

console.log(JSON.stringify(out));
