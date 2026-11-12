// Actionable routes: a userId in the request is not a credential.
// requireAuth must demand a session or the webhook secret when
// SESSION_SECRET is set, and overwrite userId with the authorized id.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signSession } from '../lib/tenant.js';
import { requireAuth } from '../lib/actionable/http.js';

const SECRET = 'actionable-guard-session';
const WEBHOOK = 'actionable-guard-webhook';
const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function fakeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}

function withEnv(env, fn) {
  const keys = ['SESSION_SECRET', 'WEBHOOK_SECRET', 'ACTIONABLE_API_KEY'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  try { return fn(); } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
}

const enforced = { SESSION_SECRET: SECRET, WEBHOOK_SECRET: WEBHOOK };

test('enforced: no credentials is 401, for query and body userIds', () => withEnv(enforced, () => {
  for (const req of [
    { method: 'GET', headers: {}, query: { userId: 'troy' } },
    { method: 'GET', headers: {}, query: { userId: TENANT_A } },
    { method: 'POST', headers: {}, query: {}, body: { userId: TENANT_A, text: 'x' } },
  ]) {
    const res = fakeRes();
    assert.equal(requireAuth(req, res), false);
    assert.equal(res.statusCode, 401);
  }
}));

test('enforced: wrong webhook secret is 401', () => withEnv(enforced, () => {
  const res = fakeRes();
  const req = { method: 'GET', headers: { 'x-webhook-secret': 'nope' }, query: { userId: TENANT_A } };
  assert.equal(requireAuth(req, res), false);
  assert.equal(res.statusCode, 401);
}));

test('enforced: session decides the user; another tenant is 403', () => withEnv(enforced, () => {
  const auth = `Bearer ${signSession(TENANT_A, SECRET, 600)}`;
  const ok = { method: 'GET', headers: { authorization: auth }, query: { userId: TENANT_A } };
  assert.equal(requireAuth(ok, fakeRes()), true);
  assert.equal(ok.query.userId, TENANT_A);

  // No userId given → session tenant is used.
  const implicit = { method: 'POST', headers: { authorization: auth }, query: {}, body: { text: 'hi' } };
  assert.equal(requireAuth(implicit, fakeRes()), true);
  assert.equal(implicit.body.userId, TENANT_A);

  const res = fakeRes();
  const cross = { method: 'GET', headers: { authorization: auth }, query: { userId: TENANT_B } };
  assert.equal(requireAuth(cross, res), false);
  assert.equal(res.statusCode, 403);
}));

test('enforced: webhook secret + tenant id works; non-UUID rejected', () => withEnv(enforced, () => {
  const ok = { method: 'PATCH', headers: { 'x-webhook-secret': WEBHOOK }, query: {}, body: { userId: TENANT_B, itemId: 'i' } };
  assert.equal(requireAuth(ok, fakeRes()), true);
  assert.equal(ok.body.userId, TENANT_B);

  const res = fakeRes();
  const bad = { method: 'GET', headers: { 'x-webhook-secret': WEBHOOK }, query: { userId: 'troy' } };
  assert.equal(requireAuth(bad, res), false);
  assert.equal(res.statusCode, 400);
}));

test('ACTIONABLE_API_KEY, when set, is still required in addition', () => withEnv({ ...enforced, ACTIONABLE_API_KEY: 'k' }, () => {
  const res = fakeRes();
  const req = { method: 'GET', headers: { 'x-webhook-secret': WEBHOOK }, query: { userId: TENANT_A } };
  assert.equal(requireAuth(req, res), false);
  assert.equal(res.statusCode, 401);
  const good = { method: 'GET', headers: { 'x-webhook-secret': WEBHOOK, 'x-actionable-key': 'k' }, query: { userId: TENANT_A } };
  assert.equal(requireAuth(good, fakeRes()), true);
}));

test('compat mode (no SESSION_SECRET): legacy non-UUID ids still pass', () => withEnv({}, () => {
  const req = { method: 'GET', headers: {}, query: { userId: 'troy' } };
  assert.equal(requireAuth(req, fakeRes()), true);
  assert.equal(req.query.userId, 'troy');
}));
