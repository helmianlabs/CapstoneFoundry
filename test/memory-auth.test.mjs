// Memory privacy gate. A tenant UUID is not a credential.
//
// Unit cases cover authorizeMemoryAccess directly (no database).
// The child process calls the real /api/memory and /api/recall-memory
// handlers with pg patched, and proves:
//   - unauthenticated GET and recall POST are 401 and run no query
//   - a session reads and writes only its own tenant
//   - a session naming another tenant is 403 and leaks nothing
//   - a webhook secret selects the tenant it names
//   - ENFORCE_TOOL_AUTH is not what closes the route
//   - compat mode still rejects a bare UUID

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { authorizeMemoryAccess, signSession } from '../lib/tenant.js';

const SECRET = 'memory-auth-unit-secret';
const WEBHOOK = 'memory-auth-unit-webhook';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function env(extra = {}) {
  return { SESSION_SECRET: SECRET, WEBHOOK_SECRET: WEBHOOK, ...extra };
}

function bearer(tenant, secret = SECRET) {
  return { headers: { authorization: `Bearer ${signSession(tenant, secret, 600)}` } };
}

test('a raw UUID does not authorize memory access', () => {
  const noCreds = { headers: {} };
  assert.deepEqual(authorizeMemoryAccess(noCreds, TENANT_A, env()), {
    ok: false, status: 401, error: 'Unauthorized',
  });
  assert.deepEqual(authorizeMemoryAccess(noCreds, TENANT_A, env({ ENFORCE_TOOL_AUTH: 'true' })), {
    ok: false, status: 401, error: 'Unauthorized',
  });
  // Compat mode (no session secret) still rejects a UUID.
  assert.deepEqual(authorizeMemoryAccess(noCreds, TENANT_A, { WEBHOOK_SECRET: WEBHOOK }), {
    ok: false, status: 401, error: 'Unauthorized',
  });
  assert.deepEqual(authorizeMemoryAccess(noCreds, TENANT_A, {}), {
    ok: false, status: 401, error: 'Unauthorized',
  });
});

test('a session authorizes only that tenant', () => {
  const own = authorizeMemoryAccess(bearer(TENANT_A), TENANT_A.toUpperCase(), env());
  assert.equal(own.ok, true);
  assert.equal(own.via, 'session');
  assert.equal(own.tenantId, TENANT_A);
  assert.equal(own.userId, TENANT_A);

  const cross = authorizeMemoryAccess(bearer(TENANT_A), TENANT_B, env());
  assert.deepEqual(cross, { ok: false, status: 403, error: 'Forbidden' });

  // A non-UUID candidate does not switch identity away from the session.
  const legacy = authorizeMemoryAccess(bearer(TENANT_A), 'troy', env());
  assert.equal(legacy.ok, true);
  assert.equal(legacy.userId, TENANT_A);

  // The tool secret does not widen a session to another tenant.
  const both = authorizeMemoryAccess(
    { headers: { ...bearer(TENANT_A).headers, 'x-webhook-secret': WEBHOOK } },
    TENANT_B,
    env(),
  );
  assert.equal(both.ok, false);
  assert.equal(both.status, 403);
});

test('a webhook secret lets the UUID select the tenant', () => {
  const tool = authorizeMemoryAccess(
    { headers: { 'X-Webhook-Secret': WEBHOOK } },
    TENANT_B,
    env(),
  );
  assert.equal(tool.ok, true);
  assert.equal(tool.via, 'tool');
  assert.equal(tool.tenantId, TENANT_B);

  const wrong = authorizeMemoryAccess(
    { headers: { 'x-webhook-secret': 'nope' } },
    TENANT_A,
    env(),
  );
  assert.equal(wrong.status, 401);

  const noTenant = authorizeMemoryAccess(
    { headers: { 'x-webhook-secret': WEBHOOK } },
    'troy',
    env(),
  );
  assert.equal(noTenant.status, 400);

  // Signed-in session still works when the tool secret is unset.
  const sessionOnly = authorizeMemoryAccess(bearer(TENANT_A), TENANT_A, { SESSION_SECRET: SECRET });
  assert.equal(sessionOnly.ok, true);
  assert.equal(sessionOnly.via, 'session');
});

test('compat mode keeps non-UUID legacy ids and still rejects a UUID', () => {
  const legacy = authorizeMemoryAccess({ headers: {} }, 'troy', {});
  assert.deepEqual(legacy, {
    ok: true, enforced: false, tenantId: null, userId: 'troy', via: 'compat',
  });
  const uuid = authorizeMemoryAccess({ headers: {} }, TENANT_A, {});
  assert.equal(uuid.ok, false);
  assert.equal(uuid.status, 401);
  const tooled = authorizeMemoryAccess(
    { headers: { 'x-webhook-secret': WEBHOOK } },
    TENANT_A,
    { WEBHOOK_SECRET: WEBHOOK },
  );
  assert.equal(tooled.ok, true);
  assert.equal(tooled.via, 'tool');
  assert.equal(tooled.tenantId, null);
  assert.equal(tooled.userId, TENANT_A);
});

function runChild() {
  const child = fileURLToPath(new URL('./fixtures/memory-auth-child.mjs', import.meta.url));
  const run = spawnSync(process.execPath, [child], {
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...process.env, SESSION_SECRET: '', WEBHOOK_SECRET: '', ENFORCE_TOOL_AUTH: '' },
  });
  assert.equal(run.status, 0, `child failed:\n${run.stderr}\n${run.stdout}`);
  const line = run.stdout.trim().split('\n').filter((l) => l.startsWith('{')).pop();
  assert.ok(line, `no JSON result from child:\n${run.stdout}\n${run.stderr}`);
  return JSON.parse(line);
}

const http = runChild();

test('unauthenticated memory GET and recall POST are rejected and do not query', () => {
  for (const key of ['getUnauth', 'recallUnauth', 'postUnauth', 'recallWrongSecret']) {
    const r = http[key];
    assert.equal(r.code, 401, key);
    assert.deepEqual(r.body, { error: 'Unauthorized' });
    assert.equal(r.queried, false, key);
    assert.equal(JSON.stringify(r.body).includes('alpha-only-fact'), false);
    assert.equal(JSON.stringify(r.body).includes('beta-only-fact'), false);
  }
});

test('a session reads and writes only the owning tenant', () => {
  assert.equal(http.getOwn.code, 200);
  assert.equal(http.getOwn.value, 'alpha-only-fact');
  assert.equal(http.getOwn.identity, '11111111-1111-4111-8111-111111111111');
  assert.equal(http.getOwn.scopedBy, 'tenant_id');
  assert.equal(JSON.stringify(http.getOwn.body).includes('beta-only-fact'), false);

  assert.equal(http.recallOwn.code, 200);
  assert.equal(http.recallOwn.found, true);
  assert.equal(http.recallOwn.value, 'alpha-only-fact');
  assert.equal(http.recallOwn.scopedBy, 'tenant_id');

  assert.equal(http.postOwn.code, 200);
  assert.equal(http.postOwn.ok, true);
  assert.equal(http.postOwn.identity, '11111111-1111-4111-8111-111111111111');
});

test('cross-tenant session access is denied', () => {
  for (const key of ['getCross', 'recallCross', 'postCross']) {
    const r = http[key];
    assert.equal(r.code, 403, key);
    assert.deepEqual(r.body, { error: 'Forbidden' });
    assert.equal(r.queried, false, key);
    assert.equal(JSON.stringify(r.body).includes('beta-only-fact'), false);
    assert.equal(JSON.stringify(r.body).includes('alpha-only-fact'), false);
  }
});

test('tool auth selects the named tenant and a bare UUID still does not', () => {
  assert.equal(http.recallTool.code, 200);
  assert.equal(http.recallTool.value, 'beta-only-fact');
  assert.equal(http.recallTool.identity, '22222222-2222-4222-8222-222222222222');
  assert.equal(http.recallTool.scopedBy, 'tenant_id');
  assert.equal(JSON.stringify(http.recallTool.body).includes('alpha-only-fact'), false);

  assert.equal(http.compatUuid.code, 401);
  assert.equal(http.compatUuid.queried, false);
  assert.equal(http.compatLegacy.code, 200);
  assert.equal(http.compatLegacy.value, 'troy-legacy-fact');
  assert.equal(http.compatLegacy.scopedBy, 'user_id');
});
