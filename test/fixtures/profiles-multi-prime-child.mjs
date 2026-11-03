// test/fixtures/profiles-multi-prime-child.mjs
//
// Bite 9 prime-level proof: the primed voice prompt follows the
// ACTIVE profile. Runs the REAL prime handler (server/handlers/
// prime-agent.js) three times for one household — a 6-8 primary
// profile plus an adult second profile — switching the active
// profile between primes through the REAL profile handler
// (POST /api/profile/active), the exact server-side surface a
// session uses:
//
//   prime 1 — kid profile active  -> kid core present
//   switch  -> adult profile      (real handler, no PIN on file)
//   prime 2 — adult active        -> kid core ABSENT; the sibling
//                                    minor never leaks into the prompt
//   switch  -> back to the kid
//   prime 3 — kid active again    -> kid core present (re-priming on
//                                    switch, bite 5's promise)
//
// Both handlers share ONE real FakeDb: seeding and the profile
// handler take the db directly; the prime handler reaches it through
// the mocked usage seam (prime-agent's getProfileDb -> getUsageDb).
// The memory layer's reads are emulated against the real pg Pool
// exactly the way the bite-2 child fixture does it. Prints ONE JSON
// line; assertions live in test/profiles-multi.test.mjs.

const SECRET = 'profiles-multi-prime-secret';
process.env.SESSION_SECRET = SECRET;
process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';
delete process.env.DATABASE_URL_MEMORY;

const { default: pg } = await import('pg');
const { FakeDb } = await import('../fake-db.mjs');

let tenantId = null;
function memRows() {
  if (!tenantId) return [];
  return [{
    id: 1, tenant_id: tenantId, identity: 'buddy', category: 'fact', name: 'marker',
    value: '{"text":"prime multi memory"}', source: 'chat', updated_at: new Date('2026-01-01T00:00:00Z'),
  }];
}

const MEMORY_UPDATE = /^\s*UPDATE\s+memory_items\s+SET\s+(.+?)\s+WHERE\s+id\s*=\s*\$(\d+)\s+AND\s+tenant_id\s*=\s*\$(\d+)\s+RETURNING\s+id\s*$/i;
const MEMORY_SELECT_BY_ID = /^\s*SELECT\s+.+?\s+FROM\s+memory_items\s+WHERE\s+tenant_id\s*=\s*\$(\d+)\s+AND\s+identity\s*=\s*\$(\d+)\s+AND\s+id\s*=\s*\$(\d+)\s+LIMIT\s+1\s*$/i;
const MEMORY_SELECT_ALL = /^\s*SELECT\s+.+?\s+FROM\s+memory_items\s+WHERE\s+tenant_id\s*=\s*\$(\d+)\s+AND\s+identity\s*=\s*\$(\d+)\s+ORDER\s+BY\s+id\s+ASC\s+LIMIT\s+\$(\d+)\s*$/i;

pg.Pool.prototype.query = async function memoryEmulator(sql, params = []) {
  const text = String(sql);
  const m = text.match(MEMORY_SELECT_BY_ID);
  if (m) {
    const rows = memRows().filter((r) => r.tenant_id === params[Number(m[1]) - 1]
      && r.identity === params[Number(m[2]) - 1] && r.id === params[Number(m[3]) - 1]);
    return { rows, rowCount: rows.length };
  }
  const a = text.match(MEMORY_SELECT_ALL);
  if (a) {
    const rows = memRows()
      .filter((r) => r.tenant_id === params[Number(a[1]) - 1] && r.identity === params[Number(a[2]) - 1])
      .slice(0, params[Number(a[3]) - 1]);
    return { rows, rowCount: rows.length };
  }
  if (MEMORY_UPDATE.test(text)) return { rows: [], rowCount: 0 };
  throw new Error(`profiles-multi-prime child: unexpected pg query: ${text.slice(0, 120)}`);
};

const fakeDb = new FakeDb();
const profilePool = { query: (sql, params) => fakeDb.query(sql, params) };

const { mock } = await import('node:test');
const usage = await import('../../lib/usage.js');
mock.module('../../lib/usage.js', {
  cache: false,
  namedExports: { ...usage, getUsageDb: () => profilePool },
});

const { createAccount } = await import('../../lib/accounts.js');
const { upsertProfile, createProfile, getProfile } = await import('../../lib/profile.js');
const { signSession } = await import('../../lib/tenant.js');
const { handleProfile } = await import('../../server/handlers/profile.js');
const { default: primeAgent } = await import('../../server/handlers/prime-agent.js');

const account = await createAccount(fakeDb, {
  email: 'household@example.com',
  password: 'a long passphrase',
});
tenantId = account.tenantId;
await upsertProfile(fakeDb, tenantId, { display_name: 'Kid', age_band: '6-8' });
const adult = await createProfile(fakeDb, tenantId, { display_name: 'Dad', age_band: 'adult' });
const primary = await getProfile(fakeDb, tenantId);

function primeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
}

async function runPrime() {
  const res = primeRes();
  await primeAgent({
    method: 'POST',
    url: 'http://localhost/api/chat-prime-agent',
    headers: { authorization: `Bearer ${signSession(tenantId, SECRET)}` },
    socket: {},
  }, res);
  const prompt = typeof res.body?.prompt === 'string' ? res.body.prompt : '';
  if (res.statusCode !== 200 || !prompt) {
    return { code: res.statusCode, kidCore: null, baseRules: null, error: res.body?.error || null };
  }
  return {
    code: res.statusCode,
    kidCore: prompt.includes('[KID SAFETY CORE'),
    baseRules: prompt.includes('[SAFETY RULES'),
  };
}

async function switchActive(profileId) {
  const res = {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
  await handleProfile({
    method: 'POST',
    url: 'http://local/api/profile/active',
    headers: { authorization: `Bearer ${signSession(tenantId, SECRET)}` },
    body: { profile_id: profileId },
  }, res, fakeDb);
  return { code: res.statusCode, error: res.body?.error || null };
}

const out = {};
out.prime1 = await runPrime();
out.switch1 = await switchActive(adult.profile_id);
out.prime2 = await runPrime();
out.switch2 = await switchActive(primary.profile_id);
out.prime3 = await runPrime();
console.log(JSON.stringify(out));
