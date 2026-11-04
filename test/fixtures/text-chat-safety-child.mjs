// test/fixtures/text-chat-safety-child.mjs — NOT a test file
// (no .test.mjs suffix): a child process driven by
// test/text-chat-client-contract.test.mjs with
// `node --experimental-test-module-mocks`, because module mocking
// needs that flag and the suite's command line is fixed (same
// pattern as test/fixtures/profile-safety-handler-child.mjs).
//
// It runs the REAL chat handler (server/handlers/chat.js) and the
// REAL lib/profile.js resolver, with exactly two seams faked:
//   - lib/usage.js getUsageDb -> a scenario-controlled fake pool, so
//     the real getProfileDb -> getProfile chain reads a fake profile
//     store. Chat is kept on a user (BYO) Gemini key so meterGate
//     skips without touching the pool for metering.
//   - lib/llm.js completeText -> a counting stub that captures the
//     system prompt, so "the LLM was / was not called" and "the kid
//     core reached the prompt" are observed, not inferred.
// Global fetch is stubbed: the OpenAI moderation endpoint is either
// DOWN (HTTP 500 — screening unavailable) or CLEAN (200, not
// flagged). No other fetch is expected on the chat path.
//
// Scenarios (safety wiring bite 6, safety-gap-map §7):
//   incompleteDown  — enforced mode, profile row exists but
//                     age_band is NULL (onboarding unfinished),
//                     moderation down: the resolver's safe default
//                     applies over TEXT chat — the standard friendly
//                     refusal, and the LLM is never called.
//   incompleteClean — the same incomplete profile, moderation
//                     clean: chat reaches the LLM once and the
//                     system prompt carries the KID SAFETY CORE
//                     (the fail-closed decision, not a neutral one).
//   adultClean      — completed adult profile (safety off),
//                     moderation clean: control — LLM called, base
//                     guardrails present, NO kid core.
// Output: one JSON line on stdout with the per-scenario summaries.
import { mock } from 'node:test';

const SECRET = 'bite6-handler-secret';
process.env.SESSION_SECRET = SECRET;
process.env.OPENAI_API_KEY = 'bite6-server-openai-key';
delete process.env.ALLOWED_ORIGINS; // chat's browser gate uses its defaults

const TENANT = '22222222-2222-4222-8222-222222222222';

// ─── Fake profile store (behind the real getProfileDb) ─────────────

let profileRow = null;
let profileQueries = 0;
const fakePool = {
  async query(sql) {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM profiles/i.test(s)) {
      profileQueries++;
      return { rows: profileRow ? [profileRow] : [] };
    }
    throw new Error(`unexpected SQL in bite-6 handler fixture: ${s.slice(0, 100)}`);
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

// ─── Fetch stub: moderation switchable ─────────────────────────────

let moderationMode = 'down'; // 'down' (500) | 'clean' (200, not flagged)
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('api.openai.com/v1/moderations')) {
    if (moderationMode === 'down') {
      return { ok: false, status: 500, text: async () => 'moderation exploded', json: async () => ({}) };
    }
    return {
      ok: true, status: 200, text: async () => '',
      json: async () => ({ results: [{ flagged: false, categories: {} }] }),
    };
  }
  throw new Error(`unexpected fetch in bite-6 handler fixture: ${u}`);
};

// ─── Handler under test (imported AFTER the mocks) ─────────────────

const { signSession } = await import('../../lib/tenant.js');
const chatHandler = (await import('../../server/handlers/chat.js')).default;

function mockRes() {
  return {
    code: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

function chatReq() {
  return {
    method: 'POST',
    headers: {
      origin: 'http://localhost:5173',
      'sec-fetch-site': 'same-origin',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      // BYO Gemini key: hasTextLlm passes and chat's meterGate skips
      // (user key), so the fake pool only ever sees profile reads.
      'x-user-key-gemini': 'bite6-user-gemini-key',
      authorization: `Bearer ${signSession(TENANT, SECRET)}`,
    },
    body: { messages: [{ role: 'user', content: 'tell me about frogs' }] },
  };
}

async function runChat() {
  lastSystem = null;
  const before = { llm: llmCalls, profiles: profileQueries };
  const res = mockRes();
  await chatHandler(chatReq(), res);
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

const row = (fields) => ({
  tenant_id: TENANT, display_name: 'Sam', about_me: null,
  parent_pin_hash: null, created_at: new Date(), updated_at: new Date(),
  ...fields,
});

const out = {};

// ─── incompleteDown / incompleteClean: age_band NULL ───────────────
profileRow = row({ age_band: null, safety_mode: false });
moderationMode = 'down';
out.incompleteDown = await runChat();

moderationMode = 'clean';
out.incompleteClean = await runChat();

// ─── adultClean: the completed-profile control ─────────────────────
profileRow = row({ age_band: 'adult', safety_mode: false });
moderationMode = 'clean';
out.adultClean = await runChat();

console.log(JSON.stringify(out));
