// test/fixtures/media-identity-chain-child.mjs — NOT a test file
// (no .test.mjs suffix): a child process driven by
// test/media-identity-chain.test.mjs with `node
// --experimental-test-module-mocks`, because module mocking needs
// that flag and the suite's command line is fixed (same pattern as
// test/fixtures/media-profile-safety-child.mjs).
//
// It runs the REAL OpenAI image handler, the REAL Runway/Veo video
// handler, and the REAL latest-image / latest-video pollers, with
// three seams faked:
//   - lib/usage.js getUsageDb -> a fake pool serving an adult profile
//     row for any tenant, so the real profile chain resolves; every
//     generation runs on a BYO provider key, so meterGate skips
//     without touching the pool and the pool only sees profile reads.
//   - @vercel/blob put/list -> an in-memory blob store, so a
//     generation's writes and a poller's reads share one "bucket"
//     and the chain is exercised end to end.
//   - pg's Pool.prototype.query -> captures the memory_items INSERTs
//     saveMediaMemory makes, so the media-memory identity key is
//     asserted, not assumed.
// Global fetch is stubbed: moderation is CLEAN; provider calls return
// immediate terminal success shapes.
//
// Scenarios (safety wiring bite 4, safety-gap-map §7):
//   enforced — session token for tenant A, but every generation body
//              CLAIMS tenant B as its userId: storage and media
//              memory must key to A (the resolved tenant), never B;
//              tenant A's pollers then retrieve the media and tenant
//              B's pollers retrieve nothing.
//   compat   — SESSION_SECRET removed: a generation under the legacy
//              userId stores under exactly that id and the compat
//              poller (query userId, no session) retrieves it; zero
//              profile queries are made.
// Output: one JSON line on stdout with the per-scenario summaries.
import { mock } from 'node:test';

const SECRET = 'bite4-handler-secret';
const WEBHOOK_SECRET = 'bite4-webhook-secret';
process.env.SESSION_SECRET = SECRET;
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.OPENAI_API_KEY = 'bite4-openai-not-real';
process.env.RUNWAY_API_KEY = 'bite4-runway-not-real';
process.env.BLOB_READ_WRITE_TOKEN = 'bite4-blob-not-real';
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';

const TENANT_A = '22222222-2222-4222-8222-222222222222';
const TENANT_B = '33333333-3333-4333-8333-333333333333';

// ─── pg seam: capture media-memory INSERTs ─────────────────────────

const memoryInserts = [];
const { Pool } = await import('pg');
Pool.prototype.query = function patchedQuery(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ');
  if (/INSERT INTO memory_items/i.test(s)) {
    memoryInserts.push([...params]);
    return Promise.resolve({ rows: [], rowCount: 1 });
  }
  throw new Error(`bite-4 fixture: unhandled SQL: ${s.slice(0, 100)}`);
};

// ─── Fake profile store (behind the real getProfileDb) ─────────────

let profileQueries = 0;
const fakePool = {
  async query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM profiles/i.test(s)) {
      profileQueries++;
      return {
        rows: [{
          tenant_id: params[0], display_name: 'Sam', age_band: 'adult',
          about_me: null, safety_mode: false, parent_pin_hash: null,
          created_at: new Date(), updated_at: new Date(),
        }],
      };
    }
    throw new Error(`unexpected SQL in bite-4 fixture: ${s.slice(0, 100)}`);
  },
};

const realUsage = await import('../../lib/usage.js');
mock.module('../../lib/usage.js', {
  cache: false,
  exports: { ...realUsage, getUsageDb: async () => fakePool },
});

// ─── Blob seam: one in-memory bucket for put + list ────────────────

const blobStore = []; // { pathname, url }
const realBlob = await import('@vercel/blob');
mock.module('@vercel/blob', {
  cache: false,
  exports: {
    ...realBlob,
    put: async (pathname) => {
      const entry = { pathname, url: `https://blob.test/${pathname}` };
      blobStore.push(entry);
      return { url: entry.url, pathname };
    },
    list: async ({ prefix } = {}) => ({
      blobs: blobStore.filter((b) => !prefix || b.pathname.startsWith(prefix)),
    }),
  },
});

// ─── Fetch stub: moderation clean, providers terminal ──────────────

const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body,
  arrayBuffer: async () => new ArrayBuffer(8),
});
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.openai.com/v1/moderations')) {
    return jsonRes({ results: [{ flagged: false, categories: {} }] });
  }
  if (u.includes('api.openai.com/v1/embeddings')) {
    return jsonRes({ data: [{ embedding: [0.01, 0.02, 0.03] }] });
  }
  if (u.includes('api.openai.com/v1/images/generations')) {
    return jsonRes({ data: [{ b64_json: Buffer.from('png-bytes').toString('base64') }] });
  }
  if (u.includes('api.dev.runwayml.com/v1/text_to_video')) {
    return jsonRes({ id: 'task-1' });
  }
  if (u.includes('api.dev.runwayml.com/v1/tasks/')) {
    return jsonRes({ status: 'SUCCEEDED', output: ['https://media.test/clip.mp4'] });
  }
  if (u.includes('media.test')) return jsonRes('');
  if (u.startsWith('https://blob.test/')) return jsonRes({ prompt: 'a frog on a log' });
  throw new Error(`unexpected fetch in bite-4 fixture: ${u}`);
};

// ─── Handlers under test (imported AFTER the mocks) ────────────────

const { signSession } = await import('../../lib/tenant.js');
const imageHandler = (await import('../../server/handlers/image.js')).default;
const veoHandler = (await import('../../server/handlers/video-runway-veo.js')).default;
const latestImage = (await import('../../server/handlers/latest-image.js')).default;
const latestVideo = (await import('../../server/handlers/latest-video.js')).default;

function mockRes() {
  return {
    code: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    send(b) { this.body = b; return this; },
    end() { return this; },
  };
}

const tokenFor = (tenant) => signSession(tenant, SECRET, 600);
const settle = () => new Promise((r) => setTimeout(r, 150));

async function generateImage({ token, claimedUserId }) {
  const before = { blobs: blobStore.length, inserts: memoryInserts.length };
  const res = mockRes();
  await imageHandler({
    method: 'POST',
    headers: {
      'x-webhook-secret': WEBHOOK_SECRET,
      'x-user-key-openai': 'bite4-user-key',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: { prompt: 'a frog on a log', userId: claimedUserId },
    query: {},
  }, res);
  await settle(); // saveMediaMemory is fire-and-forget in the handler
  return {
    code: res.code,
    url: res.body?.url || null,
    putPaths: blobStore.slice(before.blobs).map((b) => b.pathname),
    insertUserIds: memoryInserts.slice(before.inserts).map((p) => p[0]),
  };
}

async function generateVideo({ token, claimedUserId }) {
  const before = { blobs: blobStore.length, inserts: memoryInserts.length };
  const res = mockRes();
  await veoHandler({
    method: 'POST',
    headers: {
      'x-webhook-secret': WEBHOOK_SECRET,
      'x-user-key-runway': 'bite4-user-key',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: { prompt: 'a frog on a log', userId: claimedUserId },
    query: {},
  }, res);
  await settle();
  return {
    code: res.code,
    url: res.body?.url || null,
    putPaths: blobStore.slice(before.blobs).map((b) => b.pathname),
    insertUserIds: memoryInserts.slice(before.inserts).map((p) => p[0]),
  };
}

async function poll(handler, { token, queryUserId } = {}) {
  const res = mockRes();
  await handler({
    method: 'GET',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
    query: { since: 0, ...(queryUserId ? { userId: queryUserId } : {}) },
  }, res);
  return { code: res.code, url: res.body?.url || null };
}

const out = {};

// ─── enforced: token = A, bodies claim B -> everything keys to A ───
out.enforcedImage = await generateImage({ token: tokenFor(TENANT_A), claimedUserId: TENANT_B });
out.enforcedVideo = await generateVideo({ token: tokenFor(TENANT_A), claimedUserId: TENANT_B });
out.pollImageA = await poll(latestImage, { token: tokenFor(TENANT_A) });
out.pollImageB = await poll(latestImage, { token: tokenFor(TENANT_B) });
out.pollVideoA = await poll(latestVideo, { token: tokenFor(TENANT_A) });
out.pollVideoB = await poll(latestVideo, { token: tokenFor(TENANT_B) });

// ─── compat: legacy userId semantics, zero profile queries ─────────
delete process.env.SESSION_SECRET;
try {
  const beforeProfiles = profileQueries;
  out.compatImage = await generateImage({ token: null, claimedUserId: 'legacy-user' });
  out.compatProfileDelta = profileQueries - beforeProfiles;
  out.pollImageCompat = await poll(latestImage, { queryUserId: 'legacy-user' });
  out.pollImageCompatOther = await poll(latestImage, { queryUserId: 'someone-else' });
} finally {
  process.env.SESSION_SECRET = SECRET;
}

console.log(JSON.stringify(out));
