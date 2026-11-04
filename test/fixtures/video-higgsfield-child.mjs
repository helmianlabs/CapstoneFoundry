// test/fixtures/video-higgsfield-child.mjs — NOT a test file
// (no .test.mjs suffix): a child process driven by
// test/video-higgsfield.test.mjs with `node
// --experimental-test-module-mocks`, because module mocking needs
// that flag and the suite's command line is fixed (same pattern as
// test/fixtures/video-omni-child.mjs).
//
// It runs the REAL video-higgsfield handler, the REAL lib/profile.js
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
// flagged), or DOWN (HTTP 500); the Higgsfield endpoints replay the
// documented flow (submit -> status polls -> CDN download),
// capturing the exact submit request (URL, body, and the auth
// header's CONSTRUCTION — verified as booleans against the fake
// credential pair, never printed). ZERO live provider calls —
// every URL is answered by the stub or throws.
//
// Scenarios (provider wiring bite H1):
//   meteredShape    — enforced, adult profile, env credential pair,
//                     clean moderation, duration 10: the submit
//                     request shape + the `Key <id>:<secret>` auth
//                     construction are captured, the gate is
//                     consulted BEFORE the provider call, the flow
//                     runs submit -> in_progress -> completed ->
//                     download, fake MP4 bytes land in Blob under
//                     the tenant prefix (+ sidecar), a URL is
//                     returned, the ledger is charged 750 credits
//                     on the video_higgsfield action, and media
//                     memory is keyed by the tenant.
//   defaultDuration — no duration in the body: the documented
//                     default 5 is submitted and metered (375).
//   flagged         — moderation flags the prompt: standard
//                     refusal, zero provider calls.
//   minorDown       — enforced, minor (9-12) profile, moderation
//                     DOWN: the profile-derived fail-closed
//                     decision refuses, zero provider calls.
//   minorWeaken     — same minor profile + moderation down, but the
//                     request CLAIMS safetyMode:false +
//                     ageBand:'adult': the profile still wins.
//   missingSecret   — env secret removed: the standard 500 naming
//                     the pair, zero provider calls.
//   missingId       — env key id removed: same 500, zero calls.
//   exhausted       — enforced + env pair, bucket fully used: 402
//                     from the gate, zero provider calls.
//   providerErr     — Higgsfield answers the submit with HTTP 500:
//                     speakable 502, no Blob write, no ledger charge.
//   failedStatus    — the job polls to status 'failed': 502, no
//                     download, no Blob write, no ledger charge.
//   nsfwStatus      — the job polls to status 'nsfw' (the
//                     provider's own moderation): speakable 200,
//                     no Blob write, no ledger charge.
//   compat          — SESSION_SECRET removed: legacy userId keys
//                     the Blob prefix, the profile store is never
//                     touched (profileDelta 0), a BYO credential
//                     pair on the request serves the generation.
// Output: one JSON line on stdout with the per-scenario summaries.
import { mock } from 'node:test';

const SECRET = 'h1-handler-secret';
const WEBHOOK_SECRET = 'h1-webhook-secret';
const HF_KEY_ID = 'h1-key-id-not-real';
const HF_KEY_SECRET = 'h1-key-secret-not-real';
process.env.SESSION_SECRET = SECRET;
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.HIGGSFIELD_API_KEY_ID = HF_KEY_ID;
process.env.HIGGSFIELD_API_SECRET = HF_KEY_SECRET;
process.env.OPENAI_API_KEY = 'h1-openai-not-real';
process.env.BLOB_READ_WRITE_TOKEN = 'h1-blob-not-real';
// Poll timings: the handler's production defaults are 5s / 270s;
// the fixture compresses them so the suite stays fast.
process.env.HIGGSFIELD_POLL_INTERVAL_MS = '1';
process.env.HIGGSFIELD_POLL_TIMEOUT_MS = '30000';
// memory.js captures its DB URL at module load (it backs the
// handler's saveMediaMemory write); the pg seam below keeps every
// query off a real database.
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';

const TENANT = '33333333-3333-4333-8333-333333333333';
const REQUEST_ID = 'hf-req-123';
const STATUS_URL = `https://api.higgsfield.ai/requests/${REQUEST_ID}/status`;
const VIDEO_URL = 'https://cdn.higgsfield.test/hf-out.mp4';
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
  throw new Error(`h1 fixture: unhandled SQL: ${s.slice(0, 100)}`);
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
    throw new Error(`unexpected SQL in h1 fixture: ${s.slice(0, 100)}`);
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

// ─── Fetch stub: moderation switchable, Higgsfield flow replayed ───

let moderationMode = 'clean'; // 'clean' | 'flagged' | 'down'
let hfMode = 'ok'; // 'ok' | 'error' | 'failed' | 'nsfw'
let statusPolls = 0;
const fetchCalls = [];
const flow = [];
const hfRequests = [];
const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(8),
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
  if (u === VIDEO_URL) {
    flow.push('download');
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      text: async () => '',
      json: async () => ({}),
      arrayBuffer: async () => FAKE_MP4,
    };
  }
  if (u.startsWith('https://api.higgsfield.ai/')) {
    events.push('provider');
    const method = String(opts.method || 'GET').toUpperCase();
    hfRequests.push({ url: u, method, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    // Status poll.
    if (u === STATUS_URL) {
      flow.push('poll');
      statusPolls++;
      if (hfMode === 'failed') {
        return jsonRes(statusPolls >= 2
          ? { status: 'failed', request_id: REQUEST_ID, error: 'fake job failure' }
          : { status: 'in_progress', request_id: REQUEST_ID, status_url: STATUS_URL });
      }
      if (hfMode === 'nsfw') {
        return jsonRes({ status: 'nsfw', request_id: REQUEST_ID, status_url: STATUS_URL });
      }
      return jsonRes(statusPolls >= 2
        ? { status: 'completed', request_id: REQUEST_ID, status_url: STATUS_URL, video: { url: VIDEO_URL } }
        : { status: 'in_progress', request_id: REQUEST_ID, status_url: STATUS_URL });
    }
    // Submit.
    if (method === 'POST') {
      flow.push('submit');
      if (hfMode === 'error') return jsonRes({ detail: 'fake higgsfield failure' }, 500);
      return jsonRes({
        status: 'queued',
        request_id: REQUEST_ID,
        status_url: STATUS_URL,
        cancel_url: `https://api.higgsfield.ai/requests/${REQUEST_ID}/cancel`,
      });
    }
  }
  throw new Error(`unexpected fetch in h1 fixture: ${u}`);
};
const countFetches = (needle, from) => fetchCalls.slice(from).filter((u) => u.includes(needle)).length;

// Verify the documented auth construction WITHOUT emitting the
// credential value: the header must be `Key <id>:<secret>` for the
// pair the scenario configured (env or request headers).
function authChecks(headers, expectId, expectSecret) {
  const auth = headers?.Authorization || headers?.authorization || '';
  const m = /^Key ([^:]+):(.+)$/.exec(auth);
  return {
    authWellFormed: Boolean(m),
    authIdMatches: m ? m[1] === expectId : false,
    authSecretMatches: m ? m[2] === expectSecret : false,
    hasIdempotencyKey: typeof (headers?.['Idempotency-Key'] || headers?.['idempotency-key']) === 'string'
      && (headers?.['Idempotency-Key'] || headers?.['idempotency-key']).length > 0,
  };
}

// ─── Handler under test (imported AFTER the mocks) ─────────────────

const { SAFE_REFUSAL } = await import('../../lib/moderation.js');
const hfHandler = (await import('../../server/handlers/video-higgsfield.js')).default;

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

async function runHf({ body = {}, headers = {}, userId = TENANT, expectMemory = 0, expectId = HF_KEY_ID, expectSecret = HF_KEY_SECRET } = {}) {
  statusPolls = 0;
  flow.length = 0;
  const before = {
    fetch: fetchCalls.length,
    profiles: profileQueries,
    puts: blobPuts.length,
    pg: pgInserts.length,
    ledger: ledgerInserts.length,
    events: events.length,
    hfReqs: hfRequests.length,
  };
  const res = mockRes();
  await hfHandler({
    method: 'POST',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET, ...headers },
    body: { prompt: 'a frog on a log', userId, ...body },
    query: {},
  }, res);
  if (expectMemory) await settleForMemory(before.pg + expectMemory);
  const ev = events.slice(before.events);
  const reqs = hfRequests.slice(before.hfReqs);
  const submit = reqs.find((r) => r.method === 'POST') || null;
  return {
    code: res.code,
    refusal: res.body?.result === SAFE_REFUSAL,
    result: typeof res.body?.result === 'string' ? res.body.result : null,
    error: typeof res.body?.error === 'string' ? res.body.error : null,
    url: typeof res.body?.url === 'string' ? res.body.url : null,
    providerField: res.body?.provider ?? null,
    modelField: res.body?.model ?? null,
    providerDelta: countFetches('api.higgsfield.ai', before.fetch),
    profileDelta: profileQueries - before.profiles,
    puts: blobPuts.slice(before.puts),
    ledger: ledgerInserts.slice(before.ledger),
    pgUsers: pgInserts.slice(before.pg).map((p) => p?.[0] ?? null),
    gateIdx: ev.indexOf('gate'),
    providerIdx: ev.indexOf('provider'),
    flow: [...flow],
    submit: submit
      ? { url: submit.url, method: submit.method, body: submit.body, ...authChecks(submit.headers, expectId, expectSecret) }
      : null,
  };
}

const out = {};

// ─── meteredShape: enforced + env pair -> shape, gate order, flow ──
profileBehavior = { kind: 'row', row: profileRow({ age_band: 'adult', safety_mode: false }) };
moderationMode = 'clean';
hfMode = 'ok';
entitlementPlan = 'buddy';
usageMicros = 0;
out.meteredShape = await runHf({ body: { duration: 10 }, expectMemory: 1 });

// ─── defaultDuration: no duration -> documented default 5 ──────────
out.defaultDuration = await runHf({ body: {}, expectMemory: 1 });

// ─── flagged: moderation flags -> refusal, zero provider calls ─────
moderationMode = 'flagged';
out.flagged = await runHf({});
moderationMode = 'clean';

// ─── minorDown: minor profile + moderation down -> profile refuses ─
profileBehavior = { kind: 'row', row: profileRow({ age_band: '9-12', safety_mode: false }) };
moderationMode = 'down';
out.minorDown = await runHf({});

// ─── minorWeaken: request claims adult -> the profile still wins ───
out.minorWeaken = await runHf({ body: { safetyMode: false, ageBand: 'adult' } });
moderationMode = 'clean';

// ─── missingSecret: env secret removed -> standard 500, no calls ───
profileBehavior = { kind: 'row', row: profileRow({ age_band: 'adult', safety_mode: false }) };
delete process.env.HIGGSFIELD_API_SECRET;
try {
  out.missingSecret = await runHf({});
} finally {
  process.env.HIGGSFIELD_API_SECRET = HF_KEY_SECRET;
}

// ─── missingId: env key id removed -> standard 500, no calls ───────
delete process.env.HIGGSFIELD_API_KEY_ID;
try {
  out.missingId = await runHf({});
} finally {
  process.env.HIGGSFIELD_API_KEY_ID = HF_KEY_ID;
}

// ─── exhausted: bucket fully used -> 402 before any provider call ──
usageMicros = 10_000_000_000; // 10,000,000 credits used of a 10,000 grant
out.exhausted = await runHf({});
usageMicros = 0;

// ─── providerErr: Higgsfield 500 on submit -> speakable 502 ────────
hfMode = 'error';
out.providerErr = await runHf({});
hfMode = 'ok';

// ─── failedStatus: job polls to 'failed' -> 502, nothing stored ────
hfMode = 'failed';
out.failedStatus = await runHf({});
hfMode = 'ok';

// ─── nsfwStatus: job polls to 'nsfw' -> speakable 200, no charge ───
hfMode = 'nsfw';
out.nsfwStatus = await runHf({});
hfMode = 'ok';

// ─── compat: no SESSION_SECRET — legacy identity, BYO pair, no profile
delete process.env.SESSION_SECRET;
try {
  profileBehavior = { kind: 'throw' }; // a single query would change the outcome
  out.compat = await runHf({
    headers: {
      'x-user-key-higgsfield_api_key_id': 'h1-user-key-id-not-real',
      'x-user-key-higgsfield_api_secret': 'h1-user-key-secret-not-real',
    },
    userId: 'legacy-user',
    expectMemory: 1,
    expectId: 'h1-user-key-id-not-real',
    expectSecret: 'h1-user-key-secret-not-real',
  });
} finally {
  process.env.SESSION_SECRET = SECRET;
}

console.log(JSON.stringify(out));
