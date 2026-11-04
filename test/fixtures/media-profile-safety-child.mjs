// test/fixtures/media-profile-safety-child.mjs — NOT a test file
// (no .test.mjs suffix): a child process driven by
// test/media-profile-safety.test.mjs with `node
// --experimental-test-module-mocks`, because module mocking needs
// that flag and the suite's command line is fixed (same pattern as
// test/fixtures/profile-safety-handler-child.mjs).
//
// It runs the REAL image-flux / video-runway / video-runway-veo /
// video-heygen handlers and the REAL lib/profile.js resolver, with
// three seams faked:
//   - lib/usage.js getUsageDb -> a scenario-controlled fake pool, so
//     the real getProfileDb -> getProfile chain reads a fake profile
//     store (a row or a store that THROWS). Every scenario runs on a
//     BYO provider key, so meterGate skips without touching the pool
//     and the pool only ever sees profile reads.
//   - pg's Pool.prototype.query -> an emulator that accepts only the
//     memory_items INSERT video-runway-veo's saveMediaMemory makes
//     after a successful generation (media identity itself is bite
//     4; here the insert just has to not reach a real database).
//   - @vercel/blob put -> a counting fake returning a stable URL, so
//     a completed generation can finish without a blob account.
// Global fetch is stubbed: the OpenAI moderation endpoint is either
// DOWN (HTTP 500 — screening unavailable) or CLEAN (200, not
// flagged); every provider URL is answered with an immediately
// terminal success shape and COUNTED, so a scenario that must not
// reach a provider proves it by the count, and one that must reach
// it proves it the same way.
//
// Scenarios (safety wiring bite 3, safety-gap-map §7):
//   minorDown   — enforced mode, minor (9-12) profile, moderation
//                 down: all four handlers refuse (fail-closed from
//                 the profile) and no provider is called.
//   minorWeaken — same minor profile and moderation down, but every
//                 request CLAIMS safetyMode:false + ageBand:'adult':
//                 the profile still wins — same refusals.
//   throws      — enforced mode, profile store THROWS, requests
//                 claim adult, moderation down: the resolver's safe
//                 default refuses — never the request inputs.
//   adultClean  — enforced mode, adult profile (safety off),
//                 moderation clean: the provider path proceeds to a
//                 completed generation for all four handlers.
//   compat      — SESSION_SECRET removed: requests are served under
//                 request safety exactly as before this bite and the
//                 profile store is never touched (profileDelta 0).
// Output: one JSON line on stdout with the per-scenario summaries.
import { mock } from 'node:test';

const SECRET = 'bite3-handler-secret';
const WEBHOOK_SECRET = 'bite3-webhook-secret';
process.env.SESSION_SECRET = SECRET;
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.OPENAI_API_KEY = 'bite3-openai-not-real';
process.env.REPLICATE_API_TOKEN = 'bite3-replicate-not-real';
process.env.RUNWAY_API_KEY = 'bite3-runway-not-real';
process.env.HEYGEN_API_KEY = 'bite3-heygen-not-real';
process.env.BLOB_READ_WRITE_TOKEN = 'bite3-blob-not-real';
// memory.js captures its DB URL at module load (it backs
// video-runway-veo's media-memory write); the pg seam below keeps
// every query off a real database.
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';

const TENANT = '22222222-2222-4222-8222-222222222222';

// ─── pg seam: only the media-memory INSERT is emulated ─────────────

const { Pool } = await import('pg');
Pool.prototype.query = function patchedQuery(sql) {
  const s = String(sql).replace(/\s+/g, ' ');
  if (/INSERT INTO memory_items/i.test(s)) {
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  throw new Error(`bite-3 fixture: unhandled SQL: ${s.slice(0, 100)}`);
};

// ─── Fake profile store (behind the real getProfileDb) ─────────────

let profileBehavior = { kind: 'throw' };
let profileQueries = 0;
const fakePool = {
  async query(sql) {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM profiles/i.test(s)) {
      profileQueries++;
      if (profileBehavior.kind === 'throw') throw new Error('profile store down (fake)');
      if (profileBehavior.kind === 'row') return { rows: [profileBehavior.row] };
      return { rows: [] };
    }
    throw new Error(`unexpected SQL in bite-3 fixture: ${s.slice(0, 100)}`);
  },
};

const realUsage = await import('../../lib/usage.js');
mock.module('../../lib/usage.js', {
  cache: false,
  exports: { ...realUsage, getUsageDb: async () => fakePool },
});

// ─── Blob seam: put() counted, returns a stable URL ────────────────

let blobPuts = 0;
const realBlob = await import('@vercel/blob');
mock.module('@vercel/blob', {
  cache: false,
  exports: {
    ...realBlob,
    put: async (pathname) => {
      blobPuts++;
      return { url: `https://blob.test/${pathname}`, pathname };
    },
  },
});

// ─── Fetch stub: moderation switchable, providers counted ──────────

let moderationMode = 'down'; // 'down' (500) | 'clean' (200, not flagged)
const fetchCalls = [];
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
  const method = String(opts.method || 'GET').toUpperCase();
  fetchCalls.push(u);
  if (u.includes('api.openai.com/v1/moderations')) {
    if (moderationMode === 'down') return jsonRes('moderation exploded', 500);
    return jsonRes({ results: [{ flagged: false, categories: {} }] });
  }
  if (u.includes('api.openai.com/v1/embeddings')) {
    // memory.js embed() on video-runway-veo's success path.
    return jsonRes({ data: [{ embedding: [0.01, 0.02, 0.03] }] });
  }
  if (u.includes('api.replicate.com')) {
    return jsonRes({ status: 'succeeded', output: ['https://media.test/flux.png'] });
  }
  if (u.includes('api.dev.runwayml.com')) {
    if (method === 'POST') return jsonRes({ id: 'task-1' });
    return jsonRes({ status: 'SUCCEEDED', output: ['https://media.test/clip.mp4'] });
  }
  if (u.includes('api.heygen.com/v2/video/generate')) {
    return jsonRes({ data: { video_id: 'vid-1' } });
  }
  if (u.includes('api.heygen.com/v1/video_status.get')) {
    return jsonRes({ data: { status: 'completed', video_url: 'https://media.test/heygen.mp4' } });
  }
  if (u.includes('media.test')) {
    return jsonRes('');
  }
  throw new Error(`unexpected fetch in bite-3 fixture: ${u}`);
};
const countFetches = (needle, from) => fetchCalls.slice(from).filter((u) => u.includes(needle)).length;

// ─── Handlers under test (imported AFTER the mocks) ────────────────

const { SAFE_REFUSAL } = await import('../../lib/moderation.js');
const fluxHandler = (await import('../../server/handlers/image-flux.js')).default;
const runwayHandler = (await import('../../server/handlers/video-runway.js')).default;
const veoHandler = (await import('../../server/handlers/video-runway-veo.js')).default;
const heygenHandler = (await import('../../server/handlers/video-heygen.js')).default;

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

function makeRunner(handler, providerNeedle, userKeyHeader) {
  return async (body = {}, { userId = TENANT } = {}) => {
    const before = { fetch: fetchCalls.length, profiles: profileQueries };
    const res = mockRes();
    await handler({
      method: 'POST',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET, [userKeyHeader]: 'bite3-user-key' },
      body: { prompt: 'a frog on a log', userId, ...body },
      query: {},
    }, res);
    return {
      code: res.code,
      refusal: res.body?.result === SAFE_REFUSAL,
      result: typeof res.body?.result === 'string' ? res.body.result : null,
      url: typeof res.body?.url === 'string' ? res.body.url : null,
      providerDelta: countFetches(providerNeedle, before.fetch),
      profileDelta: profileQueries - before.profiles,
    };
  };
}

const runFlux = makeRunner(fluxHandler, 'api.replicate.com', 'x-user-key-replicate');
const runRunway = makeRunner(runwayHandler, 'api.dev.runwayml.com', 'x-user-key-runway');
const runVeo = makeRunner(veoHandler, 'api.dev.runwayml.com', 'x-user-key-runway');
const runHeygen = makeRunner(heygenHandler, 'api.heygen.com', 'x-user-key-heygen');

const profileRow = (fields) => ({
  tenant_id: TENANT, display_name: 'Sam', about_me: null,
  parent_pin_hash: null, created_at: new Date(), updated_at: new Date(),
  ...fields,
});

const runAll = async (body = {}, opts = {}) => ({
  flux: await runFlux(body, opts),
  runway: await runRunway(body, opts),
  veo: await runVeo(body, opts),
  heygen: await runHeygen(body, opts),
});

const out = {};

// ─── minorDown: minor profile + moderation down -> refuse ──────────
profileBehavior = { kind: 'row', row: profileRow({ age_band: '9-12', safety_mode: false }) };
moderationMode = 'down';
out.minorDown = await runAll();

// ─── minorWeaken: requests claim adult / safety off -> still refuse ─
const weaken = { safetyMode: false, ageBand: 'adult' };
out.minorWeaken = await runAll({ ...weaken });

// ─── throws: store down + requests claim adult -> safe default ─────
profileBehavior = { kind: 'throw' };
out.throws = await runAll({ ...weaken });

// ─── adultClean: adult profile + clean moderation -> proceeds ──────
profileBehavior = { kind: 'row', row: profileRow({ age_band: 'adult', safety_mode: false }) };
moderationMode = 'clean';
out.adultClean = await runAll();

// ─── compat: no SESSION_SECRET — request safety, zero profile reads ─
delete process.env.SESSION_SECRET;
try {
  profileBehavior = { kind: 'throw' }; // a single query would change the outcome
  out.compat = await runAll({}, { userId: 'legacy-user' });
} finally {
  process.env.SESSION_SECRET = SECRET;
}

console.log(JSON.stringify(out));
