// test/fixtures/profile-safety-handler-child.mjs — NOT a test file
// (no .test.mjs suffix): a child process driven by
// test/profile-safety-handlers.test.mjs with `node
// --experimental-test-module-mocks`, because module mocking needs
// that flag and the suite's command line is fixed (same pattern as
// test/fixtures/actionable-handler-child.mjs).
//
// It runs the REAL chat / speak / image / video handlers and the
// REAL lib/profile.js resolver, with exactly two seams faked:
//   - lib/usage.js getUsageDb -> a scenario-controlled fake pool, so
//     the real getProfileDb -> getProfile chain reads a fake profile
//     store (a row, no row, or a store that THROWS). Metering still
//     runs the real code; chat is kept on a user (BYO) Gemini key so
//     meterGate skips without touching the pool, and every media /
//     speak scenario refuses at moderation, before metering.
//   - lib/llm.js completeText -> a counting stub that captures the
//     system prompt, so "the LLM was / was not called" and "the kid
//     core reached the prompt" are observed, not inferred.
// Global fetch is stubbed: the OpenAI moderation endpoint is either
// DOWN (HTTP 500 — screening unavailable) or CLEAN (200, not
// flagged); every provider URL is answered benignly and COUNTED, so
// a scenario that must not reach a provider proves it by the count.
//
// Scenarios (safety wiring bite 1, safety-gap-map §7):
//   throws      — enforced mode, profile store throws, moderation
//                 down: all four handlers refuse; no provider / LLM
//                 call happens; the store really was consulted.
//   minorWeaken — enforced mode, minor profile row, moderation down,
//                 and every request CLAIMS safetyMode:false +
//                 ageBand:'adult': the profile still wins — same
//                 refusals. Request fields cannot weaken a profile
//                 decision.
//   minorClean  — minor profile, moderation clean: chat calls the
//                 LLM once and the system prompt carries the kid
//                 safety core (profile inputs reached the prompt).
//   adultClean  — adult profile (safety off), moderation clean:
//                 chat calls the LLM once and the prompt carries the
//                 base guardrails but NOT the kid core.
//   noTenant    — enforced mode, chat with no session token: 401,
//                 LLM never called (bite 1's chat rejection).
//   compat      — SESSION_SECRET removed: chat serves under request
//                 safety exactly as before, and makes NO profile
//                 query at all (profileDelta 0 even though the fake
//                 store is set to throw).
// Output: one JSON line on stdout with the per-scenario summaries.
import { mock } from 'node:test';

const SECRET = 'bite1-handler-secret';
const WEBHOOK_SECRET = 'bite1-webhook-secret';
process.env.SESSION_SECRET = SECRET;
process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;
process.env.OPENAI_API_KEY = 'bite1-openai-not-real';
process.env.ELEVENLABS_API_KEY = 'bite1-elevenlabs-not-real';
process.env.RUNWAY_API_KEY = 'bite1-runway-not-real';
process.env.BLOB_READ_WRITE_TOKEN = 'bite1-blob-not-real';
delete process.env.ALLOWED_ORIGINS; // chat's browser gate uses its defaults

const TENANT = '11111111-1111-4111-8111-111111111111';

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
    throw new Error(`unexpected SQL in bite-1 handler fixture: ${s.slice(0, 100)}`);
  },
};

const realUsage = await import('../../lib/usage.js');
mock.module('../../lib/usage.js', {
  cache: false,
  exports: { ...realUsage, getUsageDb: async () => fakePool },
});

let llmCalls = 0;
let lastSystem = null;
const realLlm = await import('../../lib/llm.js');
mock.module('../../lib/llm.js', {
  cache: false,
  exports: {
    ...realLlm,
    completeText: async ({ system } = {}) => {
      llmCalls++;
      lastSystem = system;
      return 'A friendly reply about frogs.';
    },
  },
});

// ─── Fetch stub: moderation switchable, providers counted ──────────

let moderationMode = 'down'; // 'down' (500) | 'clean' (200, not flagged)
const fetchCalls = [];
globalThis.fetch = async (url) => {
  const u = String(url);
  fetchCalls.push(u);
  if (u.includes('api.openai.com/v1/moderations')) {
    if (moderationMode === 'down') {
      return { ok: false, status: 500, text: async () => 'moderation exploded', json: async () => ({}) };
    }
    return {
      ok: true, status: 200, text: async () => '',
      json: async () => ({ results: [{ flagged: false, categories: {} }] }),
    };
  }
  if (u.includes('api.elevenlabs.io')) {
    return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4), text: async () => '', json: async () => ({}) };
  }
  if (u.includes('api.openai.com/v1/images/generations')) {
    return { ok: true, status: 200, text: async () => '', json: async () => ({ data: [{ url: 'https://example.com/img.png' }] }) };
  }
  if (u.includes('api.dev.runwayml.com')) {
    return { ok: true, status: 200, text: async () => '', json: async () => ({ id: 'task-1' }) };
  }
  throw new Error(`unexpected fetch in bite-1 handler fixture: ${u}`);
};
const countFetches = (needle, from) => fetchCalls.slice(from).filter((u) => u.includes(needle)).length;

// ─── Handlers under test (imported AFTER the mocks) ────────────────

const { signSession } = await import('../../lib/tenant.js');
const { SAFE_REFUSAL } = await import('../../lib/moderation.js');
const chatHandler = (await import('../../server/handlers/chat.js')).default;
const speakHandler = (await import('../../server/handlers/speak.js')).default;
const imageHandler = (await import('../../server/handlers/image.js')).default;
const videoHandler = (await import('../../server/handlers/video.js')).default;

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

const token = () => signSession(TENANT, SECRET);

function chatReq({ auth = true, body = {} } = {}) {
  return {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      // BYO Gemini key: hasTextLlm passes and chat's meterGate skips
      // (user key), so the fake pool only ever sees profile reads.
      'x-user-key-gemini': 'bite1-user-gemini-key',
      ...(auth ? { authorization: `Bearer ${token()}` } : {}),
    },
    body: { messages: [{ role: 'user', content: 'tell me about frogs' }], ...body },
  };
}

async function runChat(req) {
  const before = { llm: llmCalls, profiles: profileQueries };
  const res = mockRes();
  await chatHandler(req, res);
  return {
    code: res.code,
    reply: res.body?.reply ?? null,
    error: res.body?.error ?? null,
    llmDelta: llmCalls - before.llm,
    profileDelta: profileQueries - before.profiles,
    kidCore: typeof lastSystem === 'string' && lastSystem.includes('[KID SAFETY CORE'),
    baseRules: typeof lastSystem === 'string' && lastSystem.includes('[SAFETY RULES'),
  };
}

async function runSpeak(body = {}) {
  const before = { fetch: fetchCalls.length, profiles: profileQueries };
  const res = mockRes();
  await speakHandler({
    method: 'POST',
    headers: { authorization: `Bearer ${token()}` },
    body: { text: 'hello there, say this out loud', ...body },
  }, res);
  return {
    code: res.code,
    refusal: res.body?.result === SAFE_REFUSAL,
    ttsDelta: countFetches('api.elevenlabs.io', before.fetch),
    profileDelta: profileQueries - before.profiles,
  };
}

async function runImage(body = {}) {
  const before = { fetch: fetchCalls.length, profiles: profileQueries };
  const res = mockRes();
  await imageHandler({
    method: 'POST',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    body: { prompt: 'a frog on a log', userId: TENANT, ...body },
    query: {},
  }, res);
  return {
    code: res.code,
    refusal: res.body?.result === SAFE_REFUSAL,
    providerDelta: countFetches('api.openai.com/v1/images/generations', before.fetch),
    profileDelta: profileQueries - before.profiles,
  };
}

async function runVideo(body = {}) {
  const before = { fetch: fetchCalls.length, profiles: profileQueries };
  const res = mockRes();
  await videoHandler({
    method: 'POST',
    headers: { 'x-webhook-secret': WEBHOOK_SECRET },
    body: { prompt: 'a frog hops', userId: TENANT, promptImage: 'https://example.com/frame.png', ...body },
    query: {},
  }, res);
  return {
    code: res.code,
    refusal: res.body?.result === SAFE_REFUSAL,
    providerDelta:
      countFetches('api.dev.runwayml.com', before.fetch)
      + countFetches('api.openai.com/v1/images/generations', before.fetch),
    profileDelta: profileQueries - before.profiles,
  };
}

const profileRow = (fields) => ({
  tenant_id: TENANT, display_name: 'Sam', about_me: null,
  parent_pin_hash: null, created_at: new Date(), updated_at: new Date(),
  ...fields,
});

const out = {};

// ─── throws: store down + moderation down (enforced) ───────────────
profileBehavior = { kind: 'throw' };
moderationMode = 'down';
out.throws = {
  chat: await runChat(chatReq()),
  speak: await runSpeak(),
  image: await runImage(),
  video: await runVideo(),
};

// ─── minorWeaken: minor profile, requests claim adult / safety off ─
profileBehavior = { kind: 'row', row: profileRow({ age_band: '9-12', safety_mode: false }) };
moderationMode = 'down';
const weaken = { safetyMode: false, ageBand: 'adult' };
out.minorWeaken = {
  chat: await runChat(chatReq({ body: { ...weaken, userContext: { name: 'Sam', ...weaken } } })),
  speak: await runSpeak({ ...weaken }),
  image: await runImage({ ...weaken }),
  video: await runVideo({ ...weaken }),
};

// ─── minorClean / adultClean: profile decides the prompt ───────────
moderationMode = 'clean';
lastSystem = null;
out.minorClean = { chat: await runChat(chatReq()) };

profileBehavior = { kind: 'row', row: profileRow({ age_band: 'adult', safety_mode: false }) };
lastSystem = null;
out.adultClean = { chat: await runChat(chatReq()) };

// ─── noTenant: enforced chat without a session token ───────────────
profileBehavior = { kind: 'throw' };
out.noTenant = { chat: await runChat(chatReq({ auth: false })) };

// ─── compat: no SESSION_SECRET — request safety, zero profile reads ─
delete process.env.SESSION_SECRET;
try {
  lastSystem = null;
  out.compat = { chat: await runChat(chatReq({ auth: false })) };
} finally {
  process.env.SESSION_SECRET = SECRET;
}

console.log(JSON.stringify(out));
