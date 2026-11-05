// test/fixtures/video-omni-child.mjs — NOT a test file
// (no .test.mjs suffix): a child process driven by
// test/video-omni.test.mjs with `node
// --experimental-test-module-mocks`, because module mocking needs
// that flag and the suite's command line is fixed (same pattern as
// test/fixtures/image-gemini-child.mjs).
//
// It runs the REAL video-omni handler, the REAL lib/profile.js
// resolver, and the REAL lib/usage.js metering, with three seams
// faked:
//   - lib/usage.js getUsageDb -> a scenario-controlled fake pool, so
//     the real getProfileDb -> getProfile chain reads a fake profile
//     store and the real meterGate / recordMetered run against fake
//     entitlements / usage / ledger tables. A shared `events` log
//     records gate vs provider order.
//   - pg's Pool.prototype.query -> an emulator that accepts only the
//     memory_items INSERT saveMediaMemory makes after a successful
//     generation, capturing its params (media memory identity).
//   - @vercel/blob put -> a recording fake returning a stable URL.
// Global fetch is stubbed and provider calls are COUNTED: the OpenAI
// moderation endpoint is CLEAN (200 not flagged), FLAGGED (200
// flagged), or DOWN (HTTP 500); the Google Interactions + Files
// endpoints replay the documented REST flow (background create ->
// interaction polls -> file-state polls -> download), capturing the
// exact create request (URL, headers, body). ZERO live provider
// calls — every URL is answered by the stub or throws.
//
// Scenarios (provider wiring bite G2′):
//   meteredShape — enforced, adult profile, env Gemini key, clean
//                 moderation: the create request shape + pinned
//                 model are captured, the gate is consulted BEFORE
//                 the provider call, the async flow runs create ->
//                 in_progress -> completed -> file PROCESSING ->
//                 ACTIVE -> download, fake MP4 bytes land in Blob
//                 under the tenant prefix (+ sidecar), a URL is
//                 returned, the ledger is charged 1100 credits on
//                 the video_omni action, and media memory is keyed
//                 by the tenant.
//   flagged     — moderation flags the prompt: standard refusal,
//                 zero provider calls.
//   minorDown   — enforced, minor (9-12) profile, moderation DOWN:
//                 the profile-derived fail-closed decision refuses,
//                 zero provider calls.
//   minorWeaken — same minor profile + moderation down, but the
//                 request CLAIMS safetyMode:false + ageBand:'adult':
//                 the profile still wins — same refusal.
//   missingKey  — no Gemini key in env and none on the request:
//                 the standard 500, zero provider calls.
//   exhausted   — enforced + env key, bucket fully used: 402 from
//                 the gate, zero provider calls.
//   providerErr — Google answers the create with HTTP 500: speakable
//                 502, no Blob write, no ledger charge.
//   failedStatus — the interaction polls to status 'failed': 502,
//                 no Blob write, no download, no ledger charge.
//   fileFailed  — the interaction completes but the file state is
//                 FAILED: 502, no download, no Blob write.
//   compat      — SESSION_SECRET removed: legacy userId keys the
//                 Blob prefix, the profile store is never touched
//                 (profileDelta 0), BYO key serves the generation.
// Output: one JSON line on stdout with the per-scenario summaries.
import { mock } from 'node:test';

const SECRET = 'g2p-handler-secret';
const WEBHOOK_SECRET = 'g2p-webhook-secret';
const GEMINI_KEY = 'g2p-gemini-not-real';
process.env.SESSION_SECRET = SECRET;
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.GEMINI_API_KEY = GEMINI_KEY;
process.env.OPENAI_API_KEY = 'g2p-openai-not-real';
process.env.BLOB_READ_WRITE_TOKEN = 'g2p-blob-not-real';
// Poll timings: the handler's documented production defaults are
// 5s / 270s; the fixture compresses them so the suite stays fast.
process.env.OMNI_POLL_INTERVAL_MS = '1';
process.env.OMNI_POLL_TIMEOUT_MS = '30000';
// memory.js captures its DB URL at module load (it backs the
// handler's saveMediaMemory write); the pg seam below keeps every
// query off a real database.
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';

const TENANT = '33333333-3333-4333-8333-333333333333';
const FILE_ID = 'omni-file-123';
const VIDEO_URI = `https://generativelanguage.googleapis.com/v1beta/files/${FILE_ID}:download?alt=media`;
const FAKE_MP4 = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]).buffer;

// ─── Shared event log (gate vs provider ordering) ──────────────────

const events = [];

// ─── pg seam: only the media-memory INSERT is emulated ─────────────

const pgInserts = [];
const { Pool } = await import('pg');
Pool.prototype.query = function patchedQuery(sql, params) {
  const s = String(sql).replace(/\s+/g, ' ');
  if (/INSERT INTO memory_items/i.test(s)) {
    pgInserts.push(params);
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  throw new Error(`g2p fixture: unhandled SQL: ${s.slice(0, 100)}`);
};

// ─── Fake store behind the real getProfileDb / meterGate ───────────
// One pool serves profiles AND the metering tables; the scenario
// knobs decide what each table answers.

let profileBehavior = { kind: 'throw' };
let profileQueries = 0;
let entitlementPlan = 'buddy';
let usageMicros = 0;
const ledgerInserts = [];
const fakePool = {
  async query(sql, params) {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM profiles/i.test(s)) {
      profileQueries++;
      if (profileBehavior.kind === 'throw') throw new Error('profile store down (fake)');
      if (profileBehavior.kind === 'row') return { rows: [profileBehavior.row] };
      return { rows: [] };
    }
    if (/FROM entitlements/i.test(s)) {
      events.push('gate');
      return {
        rows: [{
          tenant_id: TENANT, plan: entitlementPlan, status: 'active',
          current_period_end: null, revenuecat_app_user_id: null,
        }],
      };
    }
    if (/FROM tenant_credit_grants/i.test(s)) {
      return { rows: [{ credits: 0 }] };
    }
    if (/FROM usage_ledger/i.test(s)) {
      return { rows: [{ micros: String(usageMicros) }] };
    }
    if (/INSERT INTO usage_ledger/i.test(s)) {
      ledgerInserts.push(params);
      events.push('ledger');
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`unexpected SQL in g2p fixture: ${s.slice(0, 100)}`);
  },
};

const realUsage = await import('../../lib/usage.js');
mock.module('../../lib/usage.js', {
  cache: false,
  exports: { ...realUsage, getUsageDb: async () => fakePool },
});

// ─── Blob seam: put() recorded, returns a stable URL ───────────────

const blobPuts = [];
const realBlob = await import('@vercel/blob');
mock.module('@vercel/blob', {
  cache: false,
  exports: {
    ...realBlob,
    put: async (pathname) => {
      blobPuts.push(pathname);
      return { url: `https://blob.test/${pathname}`, pathname };
    },
  },
});

// ─── Fetch stub: moderation switchable, Google flow replayed ───────

let moderationMode = 'clean'; // 'clean' | 'flagged' | 'down'
let googleMode = 'ok'; // 'ok' | 'error' | 'failed' | 'filefailed'
let interactionPolls = 0;
let filePolls = 0;
const fetchCalls = [];
const flow = [];
const googleRequests = [];
const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(8),
});

const completedInteraction = () => ({
  id: 'v1_omni_test',
  status: 'completed',
  model: 'gemini-omni-1.1-flash',
  object: 'interaction',
  steps: [
    { type: 'user_input', content: [{ type: 'text', text: 'a frog on a log' }] },
    { type: 'thought', content: [{ text: 'thinking', type: 'thought' }] },
    {
      type: 'model_output',
      content: [{ type: 'video', mime_type: 'video/mp4', uri: VIDEO_URI }],
    },
  ],
});

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  fetchCalls.push(u);
  if (u.includes('api.openai.com/v1/moderations')) {
    if (moderationMode === 'down') return jsonRes('moderation exploded', 500);
    if (moderationMode === 'flagged') return jsonRes({ results: [{ flagged: true, categories: { sexual: true } }] });
    return jsonRes({ results: [{ flagged: false, categories: {} }] });
  }
  if (u.includes('api.openai.com/v1/embeddings')) {
    // memory.js embed() on the handler's saveMediaMemory path.
    return jsonRes({ data: [{ embedding: [0.01, 0.02, 0.03] }] });
  }
  if (u.includes(':embedContent')) {
    // memory.js embed() tries Gemini first since 2026-11-05 (free road);
    // a valid 1536-dim reply keeps it off the OpenAI fallback above.
    return jsonRes({ embedding: { values: Array(1536).fill(0.01) } });
  }
  if (u.includes('generativelanguage.googleapis.com')) {
    events.push('provider');
    const method = String(opts.method || 'GET').toUpperCase();
    googleRequests.push({ url: u, method, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    // Files download — check before the plain files GET.
    if (u.includes(':download')) {
      flow.push('download');
      return {
        ok: true, status: 200,
        headers: { get: () => null },
        text: async () => '',
        json: async () => ({}),
        arrayBuffer: async () => FAKE_MP4,
      };
    }
    // File state poll.
    if (u.includes(`/v1beta/files/${FILE_ID}`)) {
      flow.push('file');
      filePolls++;
      if (googleMode === 'filefailed') return jsonRes({ name: `files/${FILE_ID}`, state: 'FAILED' });
      return jsonRes({ name: `files/${FILE_ID}`, state: filePolls >= 2 ? 'ACTIVE' : 'PROCESSING' });
    }
    // Interaction poll.
    if (u.includes('/v1beta/interactions/')) {
      flow.push('poll');
      interactionPolls++;
      if (googleMode === 'failed') {
        return jsonRes(interactionPolls >= 2
          ? { id: 'v1_omni_test', status: 'failed', model: 'gemini-omni-1.1-flash', object: 'interaction' }
          : { id: 'v1_omni_test', status: 'in_progress', model: 'gemini-omni-1.1-flash', object: 'interaction' });
      }
      return jsonRes(interactionPolls >= 2
        ? completedInteraction()
        : { id: 'v1_omni_test', status: 'in_progress', model: 'gemini-omni-1.1-flash', object: 'interaction', steps: [] });
    }
    // Interaction create.
    if (u.includes('/v1beta/interactions')) {
      flow.push('create');
      if (googleMode === 'error') return jsonRes({ error: { message: 'fake google failure' } }, 500);
      return jsonRes({ id: 'v1_omni_test', status: 'in_progress', model: 'gemini-omni-1.1-flash', object: 'interaction' });
    }
  }
  throw new Error(`unexpected fetch in g2p fixture: ${u}`);
};
const countFetches = (needle, from) => fetchCalls.slice(from).filter((u) => u.includes(needle) && !u.includes(':embedContent')).length;

// ─── Handler under test (imported AFTER the mocks) ─────────────────

const { SAFE_REFUSAL } = await import('../../lib/moderation.js');
const omniHandler = (await import('../../server/handlers/video-omni.js')).default;

function mockRes() {
  return {
    code: null, body: null, headers: {}, sent: null,
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.sent = b; return this; },
    end() { return this; },
  };
}

const profileRow = (fields) => ({
  tenant_id: TENANT, display_name: 'Sam', about_me: null,
  parent_pin_hash: null, created_at: new Date(), updated_at: new Date(),
  ...fields,
});

// saveMediaMemory is fire-and-forget in the handler; give its
// embed + INSERT chain a bounded window to land before measuring.
async function settleForMemory(expected) {
  for (let i = 0; i < 60 && pgInserts.length < expected; i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function runOmni({ body = {}, headers = {}, userId = TENANT, expectMemory = 0 } = {}) {
  interactionPolls = 0;
  filePolls = 0;
  flow.length = 0;
  const before = {
    fetch: fetchCalls.length,
    profiles: profileQueries,
    puts: blobPuts.length,
    pg: pgInserts.length,
    ledger: ledgerInserts.length,
    events: events.length,
    googleReqs: googleRequests.length,
  };
  const res = mockRes();
  await omniHandler({
    method: 'POST',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET, ...headers },
    body: { prompt: 'a frog on a log', userId, ...body },
    query: {},
  }, res);
  if (expectMemory) await settleForMemory(before.pg + expectMemory);
  const ev = events.slice(before.events);
  const reqs = googleRequests.slice(before.googleReqs);
  return {
    code: res.code,
    refusal: res.body?.result === SAFE_REFUSAL,
    result: typeof res.body?.result === 'string' ? res.body.result : null,
    error: typeof res.body?.error === 'string' ? res.body.error : null,
    url: typeof res.body?.url === 'string' ? res.body.url : null,
    providerField: res.body?.provider ?? null,
    modelField: res.body?.model ?? null,
    providerDelta: countFetches('generativelanguage.googleapis.com', before.fetch),
    profileDelta: profileQueries - before.profiles,
    puts: blobPuts.slice(before.puts),
    ledger: ledgerInserts.slice(before.ledger),
    pgUsers: pgInserts.slice(before.pg).map((p) => p?.[0] ?? null),
    gateIdx: ev.indexOf('gate'),
    providerIdx: ev.indexOf('provider'),
    flow: [...flow],
    create: reqs.find((r) => r.method === 'POST') || null,
    reqs,
  };
}

const out = {};

// ─── meteredShape: enforced + env key -> shape, gate order, flow, storage
profileBehavior = { kind: 'row', row: profileRow({ age_band: 'adult', safety_mode: false }) };
moderationMode = 'clean';
googleMode = 'ok';
entitlementPlan = 'buddy';
usageMicros = 0;
out.meteredShape = await runOmni({ body: { aspect: 'portrait' }, expectMemory: 1 });

// ─── flagged: moderation flags -> refusal, zero provider calls ─────
moderationMode = 'flagged';
out.flagged = await runOmni({});
moderationMode = 'clean';

// ─── minorDown: minor profile + moderation down -> profile refuses ─
profileBehavior = { kind: 'row', row: profileRow({ age_band: '9-12', safety_mode: false }) };
moderationMode = 'down';
out.minorDown = await runOmni({});

// ─── minorWeaken: request claims adult -> the profile still wins ───
out.minorWeaken = await runOmni({ body: { safetyMode: false, ageBand: 'adult' } });
moderationMode = 'clean';

// ─── missingKey: no env key, none on the request -> standard 500 ───
profileBehavior = { kind: 'row', row: profileRow({ age_band: 'adult', safety_mode: false }) };
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_GENAI_API_KEY;
try {
  out.missingKey = await runOmni({});
} finally {
  process.env.GEMINI_API_KEY = GEMINI_KEY;
}

// ─── exhausted: bucket fully used -> 402 before any provider call ──
usageMicros = 10_000_000_000; // 10,000,000 credits used of a 10,000 grant
out.exhausted = await runOmni({});
usageMicros = 0;

// ─── providerErr: Google 500 on create -> speakable 502, no storage ─
googleMode = 'error';
out.providerErr = await runOmni({});
googleMode = 'ok';

// ─── failedStatus: interaction polls to 'failed' -> 502, no storage ─
googleMode = 'failed';
out.failedStatus = await runOmni({});
googleMode = 'ok';

// ─── fileFailed: interaction completes, file state FAILED -> 502 ───
googleMode = 'filefailed';
out.fileFailed = await runOmni({});
googleMode = 'ok';

// ─── compat: no SESSION_SECRET — legacy identity, zero profile reads
delete process.env.SESSION_SECRET;
try {
  profileBehavior = { kind: 'throw' }; // a single query would change the outcome
  out.compat = await runOmni({
    headers: { 'x-user-key-gemini': 'g2p-user-gemini-not-real' },
    userId: 'legacy-user',
    expectMemory: 1,
  });
} finally {
  process.env.SESSION_SECRET = SECRET;
}

console.log(JSON.stringify(out));
