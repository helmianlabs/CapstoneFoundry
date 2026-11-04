// test/fixtures/search-browse-safety-child.mjs — NOT a test file
// (no .test.mjs suffix): a child process driven by
// test/search-browse-profile-safety.test.mjs with `node
// --experimental-test-module-mocks`, because module mocking needs
// that flag and the suite's command line is fixed (same pattern as
// test/fixtures/media-profile-safety-child.mjs).
//
// It runs the REAL search / browse handlers and the REAL
// lib/profile.js resolver, with three seams faked:
//   - lib/usage.js getUsageDb -> a scenario-controlled fake pool, so
//     the real getProfileDb -> getProfile chain reads a fake profile
//     store (a row, or a store that THROWS).
//   - lib/llm.js completeText / duckDuckGoSearch -> counting stubs
//     (the summary text is scenario-controlled), and hasTextLlm ->
//     true, so "the web/LLM was or was not called" is observed, not
//     inferred. NO real web fetch and NO real provider call happens.
//   - Global fetch: the OpenAI moderation endpoint is either DOWN
//     (HTTP 500 — screening unavailable) or CLEAN-MODE (200; flagged
//     exactly when the screened input carries the FLAG MARKER, which
//     stands in for content moderation would flag); the browsed page
//     URL is answered with scenario-controlled HTML and COUNTED.
//
// Scenarios (safety wiring bite 7, safety-gap-map §7):
//   minorDown      — enforced mode, minor (9-12) profile, moderation
//                    down: search refuses before any web/LLM call;
//                    browse returns the unsafe-site refusal with no
//                    page content and no summary.
//   minorWeaken    — same minor profile and moderation down, but
//                    every request CLAIMS safetyMode:false +
//                    ageBand:'adult': the profile still wins.
//   adultClean     — enforced mode, adult profile (safety off),
//                    moderation clean: both tools behave exactly as
//                    before this bite (web search runs, page is
//                    fetched, the summary is returned).
//   flaggedPage    — page text carries the flag marker: browse
//                    refuses it under BOTH a minor and an adult
//                    profile, and never calls the summarizer.
//   flaggedQuery   — the query itself carries the flag marker:
//                    search refuses it under an adult profile too
//                    (a flagged result refuses in either posture).
//   flaggedSummary — query and page screen clean, but the produced
//                    summary carries the flag marker: the output
//                    screen refuses it on both tools and the flagged
//                    text never reaches the caller.
//   noIdentity     — enforced mode, no userId and no session token:
//                    both handlers reject 400 (the tool-handler
//                    tenant rule) and nothing is called.
//   compat         — SESSION_SECRET removed: both tools are served
//                    under request safety with moderation down
//                    (historical fail-open) and the profile store is
//                    never touched (profileDelta 0).
// Output: one JSON line on stdout with the per-scenario summaries.
import { mock } from 'node:test';

const SECRET = 'bite7-handler-secret';
process.env.SESSION_SECRET = SECRET;
process.env.OPENAI_API_KEY = 'bite7-openai-not-real';
// requireToolAuth stays a no-op (ENFORCE_TOOL_AUTH unset), exactly
// as in production until that rollout flag is set.
delete process.env.ENFORCE_TOOL_AUTH;

const TENANT = '77777777-7777-4777-8777-777777777777';
const MARKER = 'ZXQFLAGGED';
const CLEAN_SUMMARY = 'Frogs are amphibians that live near ponds and eat flies.';
const PAGE_TEXT_SNIPPET = 'Frogs are amphibians. They eat flies and live near ponds.';

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
    throw new Error(`unexpected SQL in bite-7 fixture: ${s.slice(0, 100)}`);
  },
};

const realUsage = await import('../../lib/usage.js');
mock.module('../../lib/usage.js', {
  cache: false,
  exports: { ...realUsage, getUsageDb: async () => fakePool },
});

// ─── LLM seam: counting stubs, scenario-controlled summary ─────────

let llmCalls = 0;
let ddgCalls = 0;
let summaryText = CLEAN_SUMMARY;
const realLlm = await import('../../lib/llm.js');
mock.module('../../lib/llm.js', {
  cache: false,
  exports: {
    ...realLlm,
    completeText: async () => { llmCalls++; return summaryText; },
    duckDuckGoSearch: async () => {
      ddgCalls++;
      return [{ title: 'All about frogs', url: 'https://example.com/frogs', snippet: 'Frogs eat flies.' }];
    },
    hasTextLlm: () => true,
  },
});

// ─── Fetch stub: moderation switchable, page fetch counted ─────────

let moderationMode = 'clean'; // 'down' (500) | 'clean' (flag iff input carries MARKER)
let pageHtml = `<html><head><title>Frogs</title></head><body><h1>All about frogs</h1><p>${PAGE_TEXT_SNIPPET}</p></body></html>`;
let pageFetches = 0;
const jsonRes = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  json: async () => body,
});
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.includes('api.openai.com/v1/moderations')) {
    if (moderationMode === 'down') return jsonRes('moderation exploded', 500);
    let input = '';
    try { input = JSON.parse(opts.body || '{}').input || ''; } catch { /* malformed -> clean */ }
    const flagged = String(input).includes(MARKER);
    return jsonRes({ results: [{ flagged, categories: flagged ? { sexual: true } : {} }] });
  }
  if (u.startsWith('https://example.com/')) {
    pageFetches++;
    return { ok: true, status: 200, text: async () => pageHtml, json: async () => ({}) };
  }
  throw new Error(`unexpected fetch in bite-7 fixture: ${u}`);
};

// ─── Handlers under test (imported AFTER the mocks) ────────────────

const { UNSAFE_QUERY_MSG, UNSAFE_SITE_MSG } = await import('../../lib/safeBrowse.js');
const searchHandler = (await import('../../server/handlers/search.js')).default;
const browseHandler = (await import('../../server/handlers/browse.js')).default;

function mockRes() {
  return {
    code: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

async function runSearch(body = {}) {
  const before = { ddg: ddgCalls, llm: llmCalls, profiles: profileQueries };
  const res = mockRes();
  await searchHandler({ method: 'POST', headers: {}, body, query: {} }, res);
  return {
    code: res.code,
    result: typeof res.body?.result === 'string' ? res.body.result : null,
    error: typeof res.body?.error === 'string' ? res.body.error : null,
    queryRefusal: res.body?.result === UNSAFE_QUERY_MSG,
    ddgDelta: ddgCalls - before.ddg,
    llmDelta: llmCalls - before.llm,
    profileDelta: profileQueries - before.profiles,
  };
}

async function runBrowse(body = {}) {
  const before = { pages: pageFetches, llm: llmCalls, profiles: profileQueries };
  const res = mockRes();
  await browseHandler({ method: 'POST', headers: {}, body, query: {} }, res);
  return {
    code: res.code,
    result: typeof res.body?.result === 'string' ? res.body.result : null,
    error: typeof res.body?.error === 'string' ? res.body.error : null,
    siteRefusal: res.body?.result === UNSAFE_SITE_MSG,
    leaksPage: typeof res.body?.result === 'string' && res.body.result.includes('amphibians'),
    leaksMarker: typeof res.body?.result === 'string' && res.body.result.includes(MARKER),
    pageDelta: pageFetches - before.pages,
    llmDelta: llmCalls - before.llm,
    profileDelta: profileQueries - before.profiles,
  };
}

const profileRow = (fields) => ({
  tenant_id: TENANT, display_name: 'Sam', about_me: null,
  parent_pin_hash: null, created_at: new Date(), updated_at: new Date(),
  ...fields,
});
const MINOR = () => ({ kind: 'row', row: profileRow({ age_band: '9-12', safety_mode: false }) });
const ADULT = () => ({ kind: 'row', row: profileRow({ age_band: 'adult', safety_mode: false }) });

const QUERY = { query: 'what do frogs eat', userId: TENANT };
const PAGE = { url: 'https://example.com/frogs', userId: TENANT };
const out = {};

// ─── minorDown: minor profile + moderation down -> refuse early ────
profileBehavior = MINOR();
moderationMode = 'down';
summaryText = CLEAN_SUMMARY;
out.minorDown = {
  search: await runSearch({ ...QUERY }),
  browse: await runBrowse({ ...PAGE }),
};

// ─── minorWeaken: requests claim adult / safety off -> still refuse ─
const weaken = { safetyMode: false, ageBand: 'adult' };
out.minorWeaken = {
  search: await runSearch({ ...QUERY, ...weaken }),
  browse: await runBrowse({ ...PAGE, ...weaken }),
};

// ─── adultClean: adult profile + clean moderation -> proceeds ──────
profileBehavior = ADULT();
moderationMode = 'clean';
out.adultClean = {
  search: await runSearch({ ...QUERY }),
  browse: await runBrowse({ ...PAGE }),
};

// ─── flaggedPage: flagged page text refused in BOTH profiles ───────
pageHtml = `<html><body><p>${PAGE_TEXT_SNIPPET} ${MARKER}</p></body></html>`;
profileBehavior = MINOR();
out.flaggedPageMinor = { browse: await runBrowse({ ...PAGE }) };
profileBehavior = ADULT();
out.flaggedPageAdult = { browse: await runBrowse({ ...PAGE }) };
pageHtml = `<html><head><title>Frogs</title></head><body><h1>All about frogs</h1><p>${PAGE_TEXT_SNIPPET}</p></body></html>`;

// ─── flaggedQuery: flagged query refused under an adult profile ────
profileBehavior = ADULT();
out.flaggedQuery = { search: await runSearch({ query: `tell me ${MARKER} things`, userId: TENANT }) };

// ─── flaggedSummary: clean inputs, flagged summary -> output screen ─
summaryText = `Here is the summary: ${MARKER} and more.`;
profileBehavior = MINOR();
out.flaggedSummary = {
  search: await runSearch({ ...QUERY }),
  browse: await runBrowse({ ...PAGE }),
};
summaryText = CLEAN_SUMMARY;

// ─── noIdentity: enforced, nothing resolvable -> 400, no calls ─────
profileBehavior = MINOR();
moderationMode = 'clean';
out.noIdentity = {
  search: await runSearch({ query: 'what do frogs eat' }),
  browse: await runBrowse({ url: 'https://example.com/frogs' }),
};

// ─── compat: no SESSION_SECRET — request safety, zero profile reads ─
delete process.env.SESSION_SECRET;
try {
  profileBehavior = { kind: 'throw' }; // a single query would change the outcome
  moderationMode = 'down'; // historical fail-open carries both tools through
  out.compat = {
    search: await runSearch({ query: 'what do frogs eat', userId: 'legacy-user' }),
    browse: await runBrowse({ url: 'https://example.com/frogs', userId: 'legacy-user' }),
  };
} finally {
  process.env.SESSION_SECRET = SECRET;
}

console.log(JSON.stringify(out));
