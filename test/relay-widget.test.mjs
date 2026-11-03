// test/relay-widget.test.mjs — relay bite R1: the hosted voice
// widget relays nothing. The breaks, each traced in the code:
//
//   1. The ElevenLabs widget path never touched the relay. The only
//      relaySend caller was sendToThinkinBuddy — the browser-voice
//      fallback — and the relay poll was gated on sessionActive, the
//      fallback orb's state, which a widget call never sets. The
//      widget's per-turn onMessage hook captured turns for the
//      transcript log and stopped there; the agent's tool template
//      (docs/elevenlabs-template/tools.md) has no relay tool either,
//      so a spoken "spin up a landing page" reached ElevenLabs and
//      died there from every direction.
//   2. The relay client that did exist sent NO identity: bare fetch,
//      no Authorization. In hosted mode relay-proxy's requireTenant
//      refuses that 401 before the entitlement gate — every sibling
//      surface (prime, conversation-turn, the media pollers) had
//      already been moved onto the session seam; the relay pair was
//      missed. Compat mode's server-held secret hid it on the
//      single-user deployment.
//   3. Every outcome was swallowed: the send's response was never
//      read, the poll returned silently on !ok. A refused door read
//      exactly like a delivered line.
//   4. No profile context: hosted rows stamped the tenant (005) but
//      nothing recorded the ACTIVE profile the session ran under.
//
// The repair these tests pin: the widget's onMessage mirrors USER
// turns through relaySend and the poll runs for the widget call's
// duration; both client calls ride apiFetch (the account session);
// failures return a result and surface once per outage with a plain
// reason; relay-http stamps the tenant's active profile — resolved
// server-side from the authenticated tenant, never from the
// request — onto hosted rows (sql/store/008), best-effort so the
// annotation can never block a delivery.
//
// Method (house patterns): the client code runs under node:vm with
// the fetch seam stubbed (test/text-chat-client-contract.test.mjs);
// the handlers run against fake databases with the seams R1 added
// for exactly this (test/relay.test.mjs). No live calls anywhere.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { channelForTenant, createPairingCode, redeemPairingCode } from '../lib/relay.js';
import { createAccount } from '../lib/accounts.js';
import { signSession } from '../lib/tenant.js';
import { createProfile, setActiveProfile, getProfile } from '../lib/profile.js';
import { handleRelayProxy } from '../server/handlers/relay-proxy.js';
import { handleRelayHttp } from '../server/handlers/relay-http.js';
import { FakeDb } from './fake-db.mjs';

const SECRET = 'relay-widget-test-secret';
process.env.SESSION_SECRET = SECRET;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function setEntitlement(db, tenantId, plan, status) {
  db.entitlements.set(tenantId, {
    tenant_id: tenantId, plan, status,
    current_period_end: null, revenuecat_app_user_id: null,
  });
}

// ─── The client: index.html's relay section under node:vm ─────────

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function sliceBetween(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after: ${startMarker}`);
  return src.slice(a, b + endMarker.length);
}

function sliceExclusive(src, startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  assert.ok(a >= 0, `start marker not found: ${startMarker}`);
  const b = src.indexOf(endMarker, a + startMarker.length);
  assert.ok(b > a, `end marker not found after: ${startMarker}`);
  return src.slice(a, b);
}

const relayClientSrc = sliceBetween(
  indexHtml,
  'let relayCursor = null;',
  'setInterval(() => { if (sessionActive || widgetCallActive) relayPoll(); }, 4000);',
);
const sendToBuddySrc = sliceExclusive(
  indexHtml,
  'async function sendToThinkinBuddy(userText) {',
  'recognition.onstart',
);

const resp = (payload, { ok = true, status = 200 } = {}) => ({
  ok, status, json: async () => payload,
});

// fetchImpl(url, opts) answers for the page's apiFetch seam. The
// harness's apiFetch emulates the shipped one (index.html): it
// attaches the stored account session to same-origin /api calls —
// which is precisely the behavior relaySend now relies on.
function makeClientHarness({ fetchImpl, profileId = null, token = 'tb-token-abc' } = {}) {
  const calls = [];
  const spoken = [];
  const bareFetchCalls = [];
  const transcriptEl = { textContent: '' };
  const apiFetch = async (url, opts = {}) => {
    const headers = { ...(opts.headers || {}) };
    if (typeof url === 'string' && url.startsWith('/api/') && token) {
      headers.Authorization = `Bearer ${token}`;
    }
    calls.push({ url, opts, headers });
    return fetchImpl(url, opts);
  };
  const context = {
    console,
    setInterval: () => 0,
    clearInterval: () => {},
    apiFetch,
    fetch: async (...args) => {
      bareFetchCalls.push(args);
      throw new Error('the relay client must not use a bare fetch');
    },
    sessionProfileId: () => profileId,
    transcriptEl,
    speak: (text, onDone) => { spoken.push(text); if (onDone) onDone(); },
    sessionActive: false,
    currentUser: { userId: 'u-1', name: 'Troy', notes: [], firstVisit: false },
    currentHistory: [],
    saveHistory: () => {},
    setStatus: () => {},
    handleActions: () => {},
    startListening: () => {},
  };
  vm.createContext(context);
  vm.runInContext(
    `${relayClientSrc}\n${sendToBuddySrc}\n;this.__x = { relaySend, relayPoll, sendToThinkinBuddy };`,
    context,
  );
  return { ...context.__x, calls, spoken, bareFetchCalls, transcriptEl, context };
}

test('client: a relay request is formed for the right door, carrying the account identity', async () => {
  const h = makeClientHarness({ fetchImpl: async () => resp({ ok: true }) });
  const out = await h.relaySend('spin up a landing page');
  assert.equal(out.ok, true); // field-wise: vm-realm objects fail deepStrictEqual on prototypes
  assert.equal(out.reason, undefined);
  assert.equal(h.calls.length, 1);
  const call = h.calls[0];
  assert.equal(call.url, '/api/relay-proxy');
  assert.equal(call.opts.method, 'POST');
  // The identity: the session the apiFetch seam attaches. The old
  // bare fetch carried no Authorization at all and hosted mode
  // refused it 401 before anything else ran.
  assert.equal(call.headers.Authorization, 'Bearer tb-token-abc');
  assert.deepEqual(JSON.parse(call.opts.body), { body: 'spin up a landing page' });
  assert.equal(h.bareFetchCalls.length, 0);
});

test('client: the send NAMES the active profile when one is known (prime parity — a name, never a selector)', async () => {
  const h = makeClientHarness({
    fetchImpl: async () => resp({ ok: true }),
    profileId: 'profile-kid-1',
  });
  await h.relaySend('tell my computer to open the calculator');
  assert.deepEqual(JSON.parse(h.calls[0].opts.body), {
    body: 'tell my computer to open the calculator',
    profileId: 'profile-kid-1',
  });
});

test('client: a refused door surfaces honestly — once per outage, with its reason — and recovery is quiet', async () => {
  let door = async () => resp({ error: 'helmian_connect_required' }, { ok: false, status: 403 });
  const h = makeClientHarness({ fetchImpl: (url, opts) => door(url, opts) });

  const first = await h.relaySend('build me a calculator');
  assert.equal(first.ok, false);
  assert.equal(first.reason, "Helmian Connect is not on this account's plan");
  assert.equal(h.spoken.length, 1);
  assert.ok(h.spoken[0].includes("I can't reach your computer right now"));
  assert.ok(h.spoken[0].includes('Helmian Connect'));
  assert.ok(h.transcriptEl.textContent.includes('Helmian Connect'));

  // Same outage, next line: reported in the result, NOT re-announced.
  const second = await h.relaySend('are you there');
  assert.equal(second.ok, false);
  assert.equal(h.spoken.length, 1);

  // The door opens: sends succeed again, no speech spent on it.
  door = async () => resp({ ok: true });
  const third = await h.relaySend('build me a calculator');
  assert.equal(third.ok, true);
  assert.equal(h.spoken.length, 1);
  assert.ok(h.transcriptEl.textContent.includes('connected again'));
});

test('client: an unreachable door (network throw) returns a reason instead of hanging or vanishing', async () => {
  const h = makeClientHarness({
    fetchImpl: async () => { throw new Error('socket hang up'); },
  });
  const out = await h.relaySend('hello computer');
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'the relay door is unreachable');
  assert.equal(h.spoken.length, 1);
  assert.ok(h.spoken[0].includes('unreachable'));
});

test('client: the poll surfaces a refusal, and a desktop answer comes back spoken', async () => {
  let door = async () => resp({ error: 'unauthorized' }, { ok: false, status: 401 });
  const h = makeClientHarness({ fetchImpl: (url, opts) => door(url, opts) });

  await h.relayPoll();
  assert.equal(h.spoken.length, 1);
  assert.ok(h.spoken[0].includes('could not verify your sign-in'));

  door = async () => resp({
    ok: true,
    cursor: 9,
    messages: [
      { from: 'desktop', body: 'Done — the landing page is up.' },
      { from: 'phone', body: 'my own line, not an answer' },
    ],
  });
  await h.relayPoll();
  // The desktop's line — and only the desktop's line — is spoken and
  // shown; the phone's own mirrored line is not read back.
  assert.ok(h.spoken.includes('Done — the landing page is up.'));
  assert.ok(!h.spoken.includes('my own line, not an answer'));
  assert.equal(h.transcriptEl.textContent, 'Helmion: Done — the landing page is up.');
  assert.equal(h.calls.at(-1).headers.Authorization, 'Bearer tb-token-abc');
});

test('client: non-relay conversation is untouched — the chat reply still lands when the relay refuses', async () => {
  const h = makeClientHarness({
    fetchImpl: async (url) => {
      if (url.startsWith('/api/relay-proxy')) {
        return resp({ error: 'helmian_connect_required' }, { ok: false, status: 403 });
      }
      if (url === '/api/chat') return resp({ reply: 'Sure thing.' });
      throw new Error(`unexpected url ${url}`);
    },
  });
  await h.sendToThinkinBuddy('hello buddy');
  await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget relay settle

  const urls = h.calls.map((c) => c.url);
  assert.ok(urls.includes('/api/relay-proxy'), 'the line was offered to the relay');
  assert.ok(urls.includes('/api/chat'), 'the chat call still happened');
  assert.ok(h.spoken.includes('Sure thing.'), "the buddy's reply was still spoken");
  assert.deepEqual(
    h.context.currentHistory.map((m) => m.role),
    ['user', 'assistant'],
  );
});

test('client wiring (static): the widget path is hooked into the relay, the browser path still is', () => {
  // The widget's per-turn hook mirrors USER turns — and only user
  // turns — into the relay.
  assert.ok(indexHtml.includes("if (turnRole === 'user') relaySend(turnContent);"));
  // A widget call marks the relay poll live for its duration, and the
  // page's three call-end detectors clear it again.
  assert.ok(indexHtml.includes('widgetCallActive = true;'));
  assert.ok(indexHtml.split('widgetCallActive = false;').length - 1 >= 3);
  assert.ok(indexHtml.includes('if (sessionActive || widgetCallActive) relayPoll();'));
  // The browser-voice path keeps its mirror.
  assert.ok(indexHtml.includes('relaySend(userText);'));
  // No bare fetch to the relay door survives anywhere in the page —
  // the identity regression cannot come back quietly.
  assert.ok(!indexHtml.includes("fetch('/api/relay-proxy"));
  assert.ok(!indexHtml.includes('fetch(`/api/relay-proxy'));
});

// ─── relay-proxy: the browser's door ───────────────────────────────

function proxyRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; },
    send(t) { this.body = t; return this; },
    end(s) { this.body = s; return this; },
  };
}

function proxyReq({ method = 'POST', token = null, query = {}, body = {} } = {}) {
  return {
    method,
    url: 'http://local/api/relay-proxy',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    query,
    body,
  };
}

function upstreamOk(calls) {
  return async (url, opts) => {
    calls.push({ url: String(url), opts });
    return { status: 200, text: async () => JSON.stringify({ ok: true }) };
  };
}

test("proxy: the caller's own session token rides upstream to the tenant's derived channel — nothing else is forwarded", async () => {
  const db = new FakeDb();
  setEntitlement(db, TENANT_A, 'helmian_connect', 'active');
  const token = signSession(TENANT_A, SECRET);
  const calls = [];
  const res = proxyRes();
  await handleRelayProxy(proxyReq({
    token,
    // A forged channel/profile in the body must not survive the
    // proxy: only the message text is forwarded, by design.
    body: { body: 'build me a calculator', profileId: 'forged', channel: 'someone-elses' },
  }), res, { db, fetchImpl: upstreamOk(calls) });

  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  const upstream = new URL(calls[0].url);
  assert.equal(upstream.searchParams.get('channel'), channelForTenant(TENANT_A));
  assert.equal(upstream.searchParams.get('role'), 'phone');
  // The credential forwarded is the CALLER's session token — hosted
  // mode consults no shared secret.
  assert.equal(calls[0].opts.headers.authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { body: 'build me a calculator' });
});

test('proxy: the poll forwards the cursor and the session; refusals happen before the door', async () => {
  const db = new FakeDb();
  setEntitlement(db, TENANT_A, 'helmian_connect', 'trialing');
  setEntitlement(db, TENANT_B, 'buddy', 'active');
  const calls = [];
  const fetchImpl = upstreamOk(calls);

  const okRes = proxyRes();
  await handleRelayProxy(proxyReq({
    method: 'GET', token: signSession(TENANT_A, SECRET), query: { since: '41' },
  }), okRes, { db, fetchImpl });
  assert.equal(okRes.statusCode, 200);
  assert.equal(new URL(calls[0].url).searchParams.get('since'), '41');
  assert.equal(calls[0].opts.headers.authorization, `Bearer ${signSession(TENANT_A, SECRET)}`);

  const anon = proxyRes();
  await handleRelayProxy(proxyReq({ method: 'GET', query: { since: '0' } }), anon, { db, fetchImpl });
  assert.equal(anon.statusCode, 401);

  const notEntitled = proxyRes();
  await handleRelayProxy(proxyReq({
    token: signSession(TENANT_B, SECRET), body: { body: 'hello' },
  }), notEntitled, { db, fetchImpl });
  assert.equal(notEntitled.statusCode, 403);
  assert.deepEqual(notEntitled.body, { error: 'helmian_connect_required' });

  assert.equal(calls.length, 1); // only the entitled poll ever reached upstream
});

test('proxy: compat mode is the original wiring — env channel + server-held secret, 503 naming the missing variable', async () => {
  const savedSecret = process.env.SESSION_SECRET;
  const savedRelaySecret = process.env.HELMION_RELAY_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    const db = new FakeDb();
    const calls = [];
    const fetchImpl = upstreamOk(calls);

    delete process.env.HELMION_RELAY_SECRET;
    const unconfigured = proxyRes();
    await handleRelayProxy(proxyReq({ body: { body: 'hi' } }), unconfigured, { db, fetchImpl });
    assert.equal(unconfigured.statusCode, 503);
    assert.deepEqual(unconfigured.body, { error: 'HELMION_RELAY_SECRET is not set on the server' });
    assert.equal(calls.length, 0);

    process.env.HELMION_RELAY_SECRET = 'compat-secret';
    const res = proxyRes();
    await handleRelayProxy(proxyReq({ body: { body: 'hi' } }), res, { db, fetchImpl });
    assert.equal(res.statusCode, 200);
    const upstream = new URL(calls[0].url);
    assert.equal(upstream.searchParams.get('channel'), 'pilot');
    assert.equal(calls[0].opts.headers.authorization, 'Bearer compat-secret');
  } finally {
    process.env.SESSION_SECRET = savedSecret;
    if (savedRelaySecret === undefined) delete process.env.HELMION_RELAY_SECRET;
    else process.env.HELMION_RELAY_SECRET = savedRelaySecret;
  }
});

// ─── relay-http: the door itself ───────────────────────────────────

// The store fake: FakeDb (tenants/profiles/entitlements) plus the
// relay pairing tables, the RelayFakeDb shape from relay.test.mjs.
class RelayStoreFakeDb extends FakeDb {
  constructor() {
    super();
    this.pairingCodes = [];
    this.devices = [];
  }

  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/relay_pairing_codes|relay_devices/i.test(s)) return this.relayQuery(s, params);
    return super.query(sql, params);
  }

  relayQuery(s, params) {
    const insertRow = (sqlText, ps) => {
      const m = sqlText.match(/INSERT INTO \w+ \(([^)]+)\)/i);
      const cols = m[1].split(',').map((x) => x.trim());
      const row = {};
      cols.forEach((c, i) => { row[c] = ps[i]; });
      return row;
    };
    if (/^UPDATE relay_pairing_codes SET used_at/i.test(s) && /WHERE tenant_id/i.test(s)) {
      let n = 0;
      for (const c of this.pairingCodes) {
        if (c.tenant_id === params[0] && c.used_at == null) { c.used_at = params[1]; n += 1; }
      }
      return { rows: [], rowCount: n };
    }
    if (/^INSERT INTO relay_pairing_codes/i.test(s)) {
      const row = insertRow(s, params);
      row.used_at = null;
      this.pairingCodes.push(row);
      return { rows: [] };
    }
    if (/^SELECT id, tenant_id FROM relay_pairing_codes/i.test(s)) {
      const rows = this.pairingCodes.filter(
        (c) => c.code_hash === params[0] && c.used_at == null && c.expires_at > params[1],
      );
      return { rows: rows.map((r) => ({ ...r })) };
    }
    if (/^UPDATE relay_pairing_codes SET used_at/i.test(s) && /WHERE id/i.test(s)) {
      const row = this.pairingCodes.find((c) => c.id === params[0]);
      if (!row || row.used_at != null) return { rows: [], rowCount: 0 };
      row.used_at = params[1];
      return { rows: [], rowCount: 1 };
    }
    if (/^INSERT INTO relay_devices/i.test(s)) {
      const row = insertRow(s, params);
      row.paired_at = new Date().toISOString();
      row.last_seen_at = null;
      row.revoked_at = null;
      this.devices.push(row);
      return { rows: [] };
    }
    if (/^SELECT id, tenant_id, device_label FROM relay_devices/i.test(s)) {
      const row = this.devices.find(
        (d) => d.device_token_hash === params[0] && d.revoked_at == null,
      );
      return { rows: row ? [{ ...row }] : [] };
    }
    if (/^UPDATE relay_devices SET last_seen_at/i.test(s)) {
      const row = this.devices.find((d) => d.id === params[0]);
      if (!row) return { rows: [], rowCount: 0 };
      row.last_seen_at = params[1];
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`RelayStoreFakeDb: unhandled SQL: ${s.slice(0, 140)}`);
  }
}

// The relay message store fake: helmion_relay + presence, with a
// switchable profile_id column (008 run or not).
class RelayHttpFakePool {
  constructor({ profileColumn = true } = {}) {
    this.rows = [];
    this.presence = new Map();
    this.profileColumn = profileColumn;
    this.nextId = 1;
  }

  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^INSERT INTO helmion_relay_presence/i.test(s)) {
      this.presence.set(`${params[0]}|${params[1]}`, new Date());
      return { rows: [] };
    }
    if (/^INSERT INTO helmion_relay \(/i.test(s)) {
      const cols = s.match(/INSERT INTO helmion_relay \(([^)]+)\)/i)[1]
        .split(',').map((x) => x.trim());
      if (cols.includes('profile_id') && !this.profileColumn) {
        throw new Error('column "profile_id" of relation "helmion_relay" does not exist');
      }
      const row = { id: this.nextId++, created_at: new Date() };
      cols.forEach((c, i) => { row[c] = params[i]; });
      this.rows.push(row);
      return { rows: [{ id: row.id, created_at: row.created_at }] };
    }
    if (/^SELECT COALESCE\(MAX\(id\), 0\) AS id FROM helmion_relay/i.test(s)) {
      const max = this.rows
        .filter((r) => r.channel === params[0])
        .reduce((a, r) => Math.max(a, r.id), 0);
      return { rows: [{ id: max }] };
    }
    if (/^SELECT id, sender, body, created_at FROM helmion_relay/i.test(s)) {
      const rows = this.rows
        .filter((r) => r.channel === params[0] && r.id > params[1] && r.sender !== params[2])
        .sort((a, b) => a.id - b.id)
        .slice(0, params[3]);
      return { rows };
    }
    if (/^SELECT role, seen_at, EXTRACT\(EPOCH FROM \(now\(\) - seen_at\)\) AS ago FROM helmion_relay_presence/i.test(s)) {
      const out = [];
      for (const [key, seen] of this.presence) {
        const [channel, role] = key.split('|');
        if (channel === params[0] && role !== params[1]) out.push({ role, seen_at: seen, ago: 0 });
      }
      return { rows: out };
    }
    throw new Error(`RelayHttpFakePool: unhandled SQL: ${s.slice(0, 140)}`);
  }
}

function httpRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; },
    send(t) { this.body = t; return this; },
    end(s) { this.body = s; return this; },
  };
}

function httpReq({ method = 'GET', query = '', token = null, body } = {}) {
  return {
    method,
    url: `http://local/api/relay-http?${query}`,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  };
}

async function hostedTenantWithProfiles(storeDb) {
  const { tenantId } = await createAccount(storeDb, {
    email: `u${Math.random().toString(36).slice(2, 10)}@example.com`,
    password: 'a long passphrase',
  });
  setEntitlement(storeDb, tenantId, 'helmian_connect', 'active');
  const grown = await createProfile(storeDb, tenantId, { display_name: 'Dad', age_band: 'adult' });
  const kid = await createProfile(storeDb, tenantId, { display_name: 'Kiddo', age_band: '9-12' });
  return { tenantId, grown, kid };
}

test("http: a hosted send is stamped with the tenant AND its ACTIVE profile — resolved server-side, the caller's channel ignored", async () => {
  const storeDb = new RelayStoreFakeDb();
  const { tenantId, kid } = await hostedTenantWithProfiles(storeDb);
  await setActiveProfile(storeDb, tenantId, kid.profile_id);
  const pool = new RelayHttpFakePool();
  const token = signSession(tenantId, SECRET);

  const res = httpRes();
  await handleRelayHttp(httpReq({
    method: 'POST',
    query: 'channel=someone-elses&role=phone',
    token,
    body: { body: 'spin up a landing page' },
  }), res, { pool, storeDb });

  assert.equal(res.statusCode, 200);
  assert.equal(pool.rows.length, 1);
  const row = pool.rows[0];
  assert.equal(row.channel, channelForTenant(tenantId));
  assert.equal(row.sender, 'phone');
  assert.equal(row.body, 'spin up a landing page');
  assert.equal(row.tenant_id, tenantId);
  assert.equal(row.profile_id, kid.profile_id); // the ACTIVE one, not the primary
});

test('http: before sql/store/008 runs, the send still lands — the profile stamp falls back, never blocks', async () => {
  const storeDb = new RelayStoreFakeDb();
  const { tenantId } = await hostedTenantWithProfiles(storeDb);
  const pool = new RelayHttpFakePool({ profileColumn: false });
  const res = httpRes();
  await handleRelayHttp(httpReq({
    method: 'POST', query: 'role=phone', token: signSession(tenantId, SECRET),
    body: { body: 'still delivered' },
  }), res, { pool, storeDb });
  assert.equal(res.statusCode, 200);
  assert.equal(pool.rows.length, 1);
  assert.equal(pool.rows[0].tenant_id, tenantId);
  assert.equal(pool.rows[0].profile_id, undefined);
});

test('http: a tenant with no profile stamps tenant only; a non-Connect tenant and a bad credential write nothing', async () => {
  const storeDb = new RelayStoreFakeDb();
  setEntitlement(storeDb, TENANT_A, 'helmian_connect', 'active'); // no profile rows at all
  setEntitlement(storeDb, TENANT_B, 'buddy', 'active');
  const pool = new RelayHttpFakePool();

  const res = httpRes();
  await handleRelayHttp(httpReq({
    method: 'POST', query: 'role=phone', token: signSession(TENANT_A, SECRET),
    body: { body: 'no profile yet' },
  }), res, { pool, storeDb });
  assert.equal(res.statusCode, 200);
  assert.equal(pool.rows[0].tenant_id, TENANT_A);
  assert.equal(pool.rows[0].profile_id, undefined);

  const refused = httpRes();
  await handleRelayHttp(httpReq({
    method: 'POST', query: 'role=phone', token: signSession(TENANT_B, SECRET),
    body: { body: 'must not land' },
  }), refused, { pool, storeDb });
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(refused.body, { error: 'helmian_connect_required' });

  const anon = httpRes();
  await handleRelayHttp(httpReq({
    method: 'POST', query: 'role=phone', token: 'not-a-real-token',
    body: { body: 'must not land' },
  }), anon, { pool, storeDb });
  assert.equal(anon.statusCode, 401);

  assert.equal(pool.rows.length, 1); // only the entitled, profile-less send
});

test('http: the round trip — the phone line reaches the paired computer, and its answer comes back', async () => {
  const storeDb = new RelayStoreFakeDb();
  const { tenantId } = await hostedTenantWithProfiles(storeDb);
  const { code } = await createPairingCode(storeDb, tenantId);
  const { deviceToken } = await redeemPairingCode(storeDb, code, 'Studio PC');
  const pool = new RelayHttpFakePool();
  const session = signSession(tenantId, SECRET);
  const deps = { pool, storeDb };

  const post = async (token, role, body) => {
    const res = httpRes();
    await handleRelayHttp(httpReq({
      method: 'POST', query: `role=${role}`, token, body: { body },
    }), res, deps);
    assert.equal(res.statusCode, 200);
    return res;
  };
  const get = async (token, role, since) => {
    const res = httpRes();
    await handleRelayHttp(httpReq({
      method: 'GET', query: `role=${role}&since=${since}`, token,
    }), res, deps);
    assert.equal(res.statusCode, 200);
    return res.body;
  };

  // Seed one line so both cursors are past the fresh-start sentinel
  // (since=0 deliberately returns no history — relay-http's contract).
  await post(session, 'phone', 'first line ever');
  const desktopWake = await get(deviceToken, 'desktop', 0);
  const phoneWake = await get(session, 'phone', 0);
  assert.equal(desktopWake.cursor, 1);
  assert.equal(phoneWake.cursor, 1);
  assert.equal(phoneWake.presence.desktop.present, true);

  // The spoken request: phone -> the paired computer's poll.
  await post(session, 'phone', 'hey Mark — spin up a landing page');
  const desktopView = await get(deviceToken, 'desktop', desktopWake.cursor);
  assert.deepEqual(
    desktopView.messages.map((m) => [m.from, m.body]),
    [['phone', 'hey Mark — spin up a landing page']],
  );

  // The answer: desktop -> the phone's poll.
  await post(deviceToken, 'desktop', 'Done — the landing page is up.');
  const phoneView = await get(session, 'phone', phoneWake.cursor);
  assert.deepEqual(
    phoneView.messages.map((m) => [m.from, m.body]),
    [['desktop', 'Done — the landing page is up.']],
  );
});

test('http: compat mode runs the original insert — secret-gated, channel from the caller, no stamps', async () => {
  const savedSecret = process.env.SESSION_SECRET;
  const savedRelaySecret = process.env.HELMION_RELAY_SECRET;
  delete process.env.SESSION_SECRET;
  process.env.HELMION_RELAY_SECRET = 'compat-secret';
  try {
    const storeDb = new RelayStoreFakeDb();
    const pool = new RelayHttpFakePool();
    const res = httpRes();
    await handleRelayHttp(httpReq({
      method: 'POST', query: 'channel=pilot&role=phone', token: 'compat-secret',
      body: { body: 'legacy line' },
    }), res, { pool, storeDb });
    assert.equal(res.statusCode, 200);
    assert.equal(pool.rows.length, 1);
    assert.equal(pool.rows[0].channel, 'pilot');
    assert.equal(pool.rows[0].tenant_id, undefined);
    assert.equal(pool.rows[0].profile_id, undefined);

    const anon = httpRes();
    await handleRelayHttp(httpReq({
      method: 'POST', query: 'channel=pilot&role=phone',
      body: { body: 'must not land' },
    }), anon, { pool, storeDb });
    assert.equal(anon.statusCode, 401);
    assert.equal(pool.rows.length, 1);
  } finally {
    process.env.SESSION_SECRET = savedSecret;
    if (savedRelaySecret === undefined) delete process.env.HELMION_RELAY_SECRET;
    else process.env.HELMION_RELAY_SECRET = savedRelaySecret;
  }
});

test('sql/store/008 adds the profile stamp the guarded way (005 precedent)', () => {
  const sql = readFileSync(new URL('../sql/store/008_relay_profile.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS profile_id'));
  assert.ok(sql.includes('helmion_relay'));
});
