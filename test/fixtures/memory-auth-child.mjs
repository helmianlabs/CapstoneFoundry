// Handler-level proof for the memory privacy gate. Not a test file.
// Patches pg.Pool.query so no database is contacted, then calls the real
// memory and recall handlers. Prints one JSON object.
//
// ENFORCE_TOOL_AUTH is left unset on purpose: the gate must hold without it.

import pg from 'pg';
import { signSession } from '../../lib/tenant.js';

process.env.DATABASE_URL_MEMORY = 'postgres://127.0.0.1:1/memory_auth_test';
process.env.SESSION_SECRET = 'memory-auth-test-secret';
process.env.WEBHOOK_SECRET = 'memory-auth-test-webhook';
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_GENAI_API_KEY;
delete process.env.ENFORCE_TOOL_AUTH;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const FACTS = {
  [TENANT_A]: 'alpha-only-fact',
  [TENANT_B]: 'beta-only-fact',
  troy: 'troy-legacy-fact',
};

const calls = [];
pg.Pool.prototype.query = async function query(sql, params) {
  const text = String(sql);
  calls.push({ sql: text, params });
  const id = params?.[0];
  const value = FACTS[id];
  if (/FROM memory_items/i.test(text) && value) {
    const now = new Date('2026-11-06T00:00:00Z');
    return {
      rows: [{
        id: `row-${id}`,
        key: 'canary',
        value,
        subject: 'canary',
        content: value,
        kind: 'fact',
        scope: 'semantic',
        importance: 1,
        confidence: 1,
        updated_at: now,
        created_at: now,
      }],
      rowCount: 1,
    };
  }
  if (/INSERT INTO memory_items/i.test(text)) {
    return { rows: [{ id: 'inserted' }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
};

const { default: memoryHandler } = await import('../../server/handlers/memory.js');
const { default: recallHandler } = await import('../../server/handlers/recall-memory.js');

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; },
  };
}

async function call(handler, req) {
  const before = calls.length;
  const res = fakeRes();
  await handler(req, res);
  const made = calls.slice(before);
  let identity = null;
  for (const q of made) {
    for (const p of q.params || []) {
      if (p === TENANT_A || p === TENANT_B || p === 'troy') identity = p;
    }
  }
  const sql = made.map((q) => q.sql).join('\n');
  return {
    code: res.statusCode,
    body: res.body,
    queried: made.length > 0,
    identity,
    scopedBy: /tenant_id/.test(sql) ? 'tenant_id' : (/user_id/.test(sql) ? 'user_id' : null),
    value: res.body?.facts?.[0]?.value || null,
    found: res.body?.found,
    ok: res.body?.ok,
  };
}

function sessionHeaders(tenant) {
  return { authorization: `Bearer ${signSession(tenant, process.env.SESSION_SECRET, 600)}` };
}

const out = {};

out.getUnauth = await call(memoryHandler, {
  method: 'GET',
  headers: {},
  query: { userId: TENANT_A },
});

out.recallUnauth = await call(recallHandler, {
  method: 'POST',
  headers: {},
  body: { userId: TENANT_A, query: 'canary code' },
});

out.postUnauth = await call(memoryHandler, {
  method: 'POST',
  headers: {},
  body: { userId: TENANT_A, key: 'canary', value: 'pwned' },
  query: {},
});

out.recallWrongSecret = await call(recallHandler, {
  method: 'POST',
  headers: { 'x-webhook-secret': 'wrong-secret' },
  body: { userId: TENANT_B, query: 'canary code' },
});

out.getOwn = await call(memoryHandler, {
  method: 'GET',
  headers: sessionHeaders(TENANT_A),
  query: { userId: TENANT_A },
});
out.getOwn.value = out.getOwn.body?.facts?.[0]?.value ?? null;

out.recallOwn = await call(recallHandler, {
  method: 'POST',
  headers: sessionHeaders(TENANT_A),
  body: { userId: TENANT_A, query: 'canary code' },
});
out.recallOwn.value = out.recallOwn.body?.facts?.[0]?.value ?? null;

out.postOwn = await call(memoryHandler, {
  method: 'POST',
  headers: sessionHeaders(TENANT_A),
  body: { userId: TENANT_A, key: 'canary', value: 'alpha-saved' },
  query: {},
});

out.getCross = await call(memoryHandler, {
  method: 'GET',
  headers: sessionHeaders(TENANT_A),
  query: { userId: TENANT_B },
});

out.recallCross = await call(recallHandler, {
  method: 'POST',
  headers: {
    ...sessionHeaders(TENANT_A),
    'x-webhook-secret': process.env.WEBHOOK_SECRET,
  },
  body: { userId: TENANT_B, query: 'canary code' },
});

out.postCross = await call(memoryHandler, {
  method: 'POST',
  headers: sessionHeaders(TENANT_A),
  body: { userId: TENANT_B, key: 'canary', value: 'beta-pwned' },
  query: {},
});

out.recallTool = await call(recallHandler, {
  method: 'POST',
  headers: { 'X-Webhook-Secret': process.env.WEBHOOK_SECRET },
  body: { userId: TENANT_B, query: 'canary code' },
});
out.recallTool.value = out.recallTool.body?.facts?.[0]?.value ?? null;

delete process.env.SESSION_SECRET;
out.compatUuid = await call(memoryHandler, {
  method: 'GET',
  headers: {},
  query: { userId: TENANT_A },
});
out.compatLegacy = await call(memoryHandler, {
  method: 'GET',
  headers: {},
  query: { userId: 'troy' },
});
out.compatLegacy.value = out.compatLegacy.body?.facts?.[0]?.value ?? null;

console.log(JSON.stringify(out));
