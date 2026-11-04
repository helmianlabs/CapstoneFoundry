// test/fixtures/prime-safety-handler-child.mjs — NOT a test file
// (no .test.mjs suffix): a child process driven by
// test/prime-safety.test.mjs with `node
// --experimental-test-module-mocks`, because module mocking needs
// that flag and the suite's command line is fixed (same pattern as
// test/fixtures/profile-safety-handler-child.mjs).
//
// It runs the REAL prime-agent handler, the REAL lib/profile.js
// resolver, and the REAL server/handlers/memory.js retrieval, with
// exactly two seams faked:
//   - lib/usage.js getUsageDb -> a scenario-controlled fake pool, so
//     the real getProfileDb -> getProfile chain reads a fake profile
//     store (a row per tenant, no row, an unfinished row, or a store
//     that THROWS). Profile reads are counted per scenario.
//   - pg's Pool.prototype.query -> a small emulator over seeded
//     memory_items (the session-identity pattern): it applies the
//     identity predicate the SQL actually carries, so tenant
//     separation of memories is genuinely exercised, not stubbed.
//
// Scenarios (safety wiring bite 2, safety-gap-map §7):
//   minorChild / minor68 / minor912 — enforced, minor age band,
//                 safety_mode off: the kid core must STILL reach the
//                 prompt (the band alone decides), with only that
//                 tenant's memories.
//   adultOff    — adult band, safety off: base rules, NO kid core.
//   adultOn     — adult band, safety on: both layers.
//   teenOff     — 13-17 band, safety off: follows the documented
//                 under-13 rule — no kid core.
//   throws      — profile store throws in enforced mode: the
//                 resolver's safe default applies (kid core
//                 present), NOT a silent no-safety prompt.
//   noRow       — no profile row: safe default (kid core present).
//   incomplete  — profile row with age_band still null: safe
//                 default (kid core present).
//   otherTenant — the second tenant (adult profile): no kid core,
//                 its own memories only — no safety state or memory
//                 crosses tenants in either direction.
//   compat      — SESSION_SECRET removed: prime serves under the
//                 legacy body userId exactly as before this bite,
//                 and makes NO profile query at all.
// Output: one JSON line on stdout with the per-scenario summaries.
import { mock } from 'node:test';

const SECRET = 'bite2-prime-secret';
process.env.SESSION_SECRET = SECRET;
delete process.env.DATABASE_URL_MEMORY;
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';

const TROY = '02070cfa-1e7c-4dc1-9bd9-31d9f9d5dcaf6';
const OTHER = '33333333-3333-4333-8333-333333333333';

// ─── Memory emulator (pg Pool seam, session-identity pattern) ──────
// Same seed composition as test/session-identity.test.mjs: Troy's
// rows include legacy user_id 'troy' rows under his tenant; the
// other tenant holds a 'troy'-tagged row and a stranger row that
// must never cross into Troy's prompt (and vice versa).
const seedRows = [
  { user_id: 'troy', tenant_id: TROY, scope: 'semantic', subject: 'dog', content: 'MARKER_DOG', importance: 0.9, confidence: 0.9, valid_until: null, updated_at: new Date('2026-10-03') },
  { user_id: 'troy', tenant_id: TROY, scope: 'semantic', subject: 'job', content: 'MARKER_JOB', importance: 0.8, confidence: 0.8, valid_until: null, updated_at: new Date('2026-10-02') },
  { user_id: TROY, tenant_id: TROY, scope: 'semantic', subject: 'self', content: 'MARKER_TENANT_SELF', importance: 0.6, confidence: 0.6, valid_until: null, updated_at: new Date('2026-09-30') },
  { user_id: 'troy', tenant_id: OTHER, scope: 'semantic', subject: 'alien', content: 'MARKER_OTHER_TENANT_TROY', importance: 0.95, confidence: 0.95, valid_until: null, updated_at: new Date('2026-10-04') },
  { user_id: 'someone', tenant_id: OTHER, scope: 'semantic', subject: 'stranger', content: 'MARKER_STRANGER', importance: 0.99, confidence: 0.99, valid_until: null, updated_at: new Date('2026-10-05') },
];

const { Pool } = await import('pg');
Pool.prototype.query = function patchedQuery(sql, params = []) {
  const s = String(sql).replace(/\s+/g, ' ').trim();
  if (/FROM memory_items/i.test(s)) {
    let rows = [...seedRows];
    const idm = s.match(/(user_id|tenant_id) = \$(\d+)/);
    if (!idm) throw new Error(`memory SELECT must carry an identity predicate: ${s}`);
    const col = idm[1];
    const val = params[Number(idm[2]) - 1];
    rows = rows.filter((r) => r[col] === val);
    const scopeM = s.match(/scope = ANY\(\$(\d+)::text\[\]\)/);
    if (scopeM) {
      const scopes = params[Number(scopeM[1]) - 1];
      rows = rows.filter((r) => scopes.includes(r.scope));
    }
    rows = rows.filter((r) => r.valid_until == null);
    rows.sort((a, b) =>
      (b.importance - a.importance) || (b.confidence - a.confidence) || (b.updated_at - a.updated_at));
    const limM = s.match(/LIMIT \$(\d+)/);
    if (limM) rows = rows.slice(0, params[Number(limM[1]) - 1]);
    return Promise.resolve({
      rows: rows.map((r) => ({ key: r.subject, value: r.content, importance: r.importance, updated_at: r.updated_at })),
      rowCount: rows.length,
    });
  }
  throw new Error(`prime-safety fixture: unhandled SQL: ${s.slice(0, 140)}`);
};

// ─── Fake profile store (behind the real getProfileDb) ─────────────
// Behavior is keyed by tenant id: each value is { kind: 'row', row }
// | { kind: 'none' } | { kind: 'throw' }.

let profileBehavior = new Map();
let profileQueries = 0;
const fakePool = {
  async query(sql, params = []) {
    const s = String(sql).replace(/\s+/g, ' ');
    if (/FROM profiles/i.test(s)) {
      profileQueries++;
      const behavior = profileBehavior.get(params[0]) || { kind: 'none' };
      if (behavior.kind === 'throw') throw new Error('profile store down (fake)');
      if (behavior.kind === 'row') return { rows: [behavior.row] };
      return { rows: [] };
    }
    throw new Error(`unexpected SQL in bite-2 prime fixture: ${s.slice(0, 100)}`);
  },
};

const realUsage = await import('../../lib/usage.js');
mock.module('../../lib/usage.js', {
  cache: false,
  exports: { ...realUsage, getUsageDb: async () => fakePool },
});

// ─── Handler under test (imported AFTER the mocks) ─────────────────

const { signSession } = await import('../../lib/tenant.js');
const primeHandler = (await import('../../server/handlers/prime-agent.js')).default;

function mockRes() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    end() { return this; },
  };
}

const profileRow = (tenantId, fields) => ({
  tenant_id: tenantId, display_name: 'Sam', about_me: null,
  parent_pin_hash: null, created_at: new Date(), updated_at: new Date(),
  ...fields,
});

async function runPrime({ token = null, body = {} } = {}) {
  const before = profileQueries;
  const res = mockRes();
  await primeHandler({
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: { userName: 'Sam', buddyName: 'ThinkinBuddy', ...body },
  }, res);
  const prompt = typeof res.body?.prompt === 'string' ? res.body.prompt : '';
  return {
    code: res.statusCode,
    ok: res.body?.ok ?? null,
    tenantId: res.body?.tenantId ?? null,
    memoryCount: res.body?.memoryCount ?? null,
    profileDelta: profileQueries - before,
    baseRules: prompt.includes('[SAFETY RULES'),
    kidCore: prompt.includes('[KID SAFETY CORE'),
    hasDog: prompt.includes('MARKER_DOG'),
    hasStranger: prompt.includes('MARKER_STRANGER'),
    hasOtherTenantTroy: prompt.includes('MARKER_OTHER_TENANT_TROY'),
  };
}

const troyToken = signSession(TROY, SECRET);
const otherToken = signSession(OTHER, SECRET);
const out = {};

// ─── Minor bands: the band alone puts the kid core in the prompt ──
for (const [name, band] of [['minorChild', 'child'], ['minor68', '6-8'], ['minor912', '9-12']]) {
  profileBehavior = new Map([[TROY, { kind: 'row', row: profileRow(TROY, { age_band: band, safety_mode: false }) }]]);
  out[name] = await runPrime({ token: troyToken, body: { userId: 'troy' } });
}

// ─── Adult / teen matrix ───────────────────────────────────────────
profileBehavior = new Map([[TROY, { kind: 'row', row: profileRow(TROY, { age_band: 'adult', safety_mode: false }) }]]);
out.adultOff = await runPrime({ token: troyToken, body: { userId: 'troy' } });

profileBehavior = new Map([[TROY, { kind: 'row', row: profileRow(TROY, { age_band: 'adult', safety_mode: true }) }]]);
out.adultOn = await runPrime({ token: troyToken, body: { userId: 'troy' } });

profileBehavior = new Map([[TROY, { kind: 'row', row: profileRow(TROY, { age_band: '13-17', safety_mode: false }) }]]);
out.teenOff = await runPrime({ token: troyToken, body: { userId: 'troy' } });

// ─── Unresolvable profile in enforced mode -> safe default ─────────
profileBehavior = new Map([[TROY, { kind: 'throw' }]]);
out.throws = await runPrime({ token: troyToken, body: { userId: 'troy' } });

profileBehavior = new Map([[TROY, { kind: 'none' }]]);
out.noRow = await runPrime({ token: troyToken, body: { userId: 'troy' } });

profileBehavior = new Map([[TROY, { kind: 'row', row: profileRow(TROY, { age_band: null, safety_mode: false }) }]]);
out.incomplete = await runPrime({ token: troyToken, body: { userId: 'troy' } });

// ─── Two tenants: neither safety state nor memory crosses ──────────
profileBehavior = new Map([
  [TROY, { kind: 'row', row: profileRow(TROY, { age_band: '9-12', safety_mode: false }) }],
  [OTHER, { kind: 'row', row: profileRow(OTHER, { age_band: 'adult', safety_mode: false }) }],
]);
out.otherTenant = await runPrime({ token: otherToken, body: { userId: 'someone' } });

// ─── Compat: no SESSION_SECRET — legacy path, zero profile reads ──
delete process.env.SESSION_SECRET;
try {
  out.compat = await runPrime({ body: { userId: 'troy' } });
} finally {
  process.env.SESSION_SECRET = SECRET;
}

console.log(JSON.stringify(out));
