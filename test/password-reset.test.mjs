// test/password-reset.test.mjs — password-reset bite: one-time reset
// tokens (lib/accounts.js, sql/store/011), the fail-soft mailer
// (lib/mailer.js), and the /api/auth reset handler shapes.
// Fake in-memory db — no live database, same posture as
// test/accounts.test.mjs. Pins the house rules this flow inherits:
// hash-only token storage (lib/relay.js pairing-code model),
// single-use race-safe consumption, and login's anti-enumeration
// rule carried into request-reset (identical 200 for known and
// unknown emails).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAccount, authenticate,
  mintPasswordResetToken, consumePasswordResetToken, updatePassword,
  hashPasswordResetToken, PASSWORD_RESET_TTL_MS,
} from '../lib/accounts.js';
import { sendPasswordResetEmail, buildResetLink } from '../lib/mailer.js';
import { handleAuth } from '../server/handlers/auth.js';

const SECRET = 'password-reset-test-secret';
process.env.SESSION_SECRET = SECRET;
// The mailer must start UNCONFIGURED for these tests (the production
// flip sets RESEND_API_KEY; the suite never inherits it).
const SAVED_RESEND = process.env.RESEND_API_KEY;
const SAVED_BASE = process.env.APP_BASE_URL;
const SAVED_FROM = process.env.RESET_FROM;
delete process.env.RESEND_API_KEY;
delete process.env.APP_BASE_URL;
delete process.env.RESET_FROM;

import { FakeDb } from './fake-db.mjs';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
}

const post = (path, body) => ({
  method: 'POST', url: `http://local${path}`, headers: {}, body,
});

/** Run fn with a stubbed global fetch; always restores the real one. */
async function withFetch(stub, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

async function account(db, email = 'reset@example.com', password = 'the old passphrase') {
  return createAccount(db, { email, password });
}

// ─── lib: mint / consume ──────────────────────────────────────────────────

test('mint -> consume round trip returns the tenant; token is 32 random bytes hex', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db);
  const { token, expiresAt } = await mintPasswordResetToken(db, tenantId);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.ok(Math.abs(new Date(expiresAt).getTime() - (Date.now() + PASSWORD_RESET_TTL_MS)) < 5000);
  assert.equal(await consumePasswordResetToken(db, token), tenantId);
});

test('the raw token never appears in stored rows — hash only', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db);
  const { token } = await mintPasswordResetToken(db, tenantId);
  assert.equal(db.rows.password_resets.length, 1);
  const row = db.rows.password_resets[0];
  assert.equal(row.token_hash, hashPasswordResetToken(token));
  assert.notEqual(row.token_hash, token);
  assert.ok(!JSON.stringify(db.rows.password_resets).includes(token));
});

test('expiry boundary: just before the TTL succeeds, at the TTL fails', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db);
  const t0 = new Date('2026-11-05T12:00:00.000Z');
  const first = await mintPasswordResetToken(db, tenantId, t0);
  const justBefore = new Date(t0.getTime() + PASSWORD_RESET_TTL_MS - 1);
  assert.equal(await consumePasswordResetToken(db, first.token, justBefore), tenantId);
  const second = await mintPasswordResetToken(db, tenantId, t0);
  const atTtl = new Date(t0.getTime() + PASSWORD_RESET_TTL_MS);
  assert.equal(await consumePasswordResetToken(db, second.token, atTtl), null);
});

test('single-use: a second consume of the same token returns null', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db);
  const { token } = await mintPasswordResetToken(db, tenantId);
  assert.equal(await consumePasswordResetToken(db, token), tenantId);
  assert.equal(await consumePasswordResetToken(db, token), null);
});

test('minting a fresh token invalidates the previous unused one', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db);
  const first = await mintPasswordResetToken(db, tenantId);
  const second = await mintPasswordResetToken(db, tenantId);
  assert.notEqual(first.token, second.token);
  assert.equal(await consumePasswordResetToken(db, first.token), null);
  assert.equal(await consumePasswordResetToken(db, second.token), tenantId);
});

test('consume: unknown, malformed, and empty tokens all return the same null', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db);
  await mintPasswordResetToken(db, tenantId);
  assert.equal(await consumePasswordResetToken(db, 'f'.repeat(64)), null);
  assert.equal(await consumePasswordResetToken(db, 'not-a-token'), null);
  assert.equal(await consumePasswordResetToken(db, ''), null);
  assert.equal(await consumePasswordResetToken(db, null), null);
  assert.equal(await consumePasswordResetToken(db, undefined), null);
});

// ─── lib: updatePassword ──────────────────────────────────────────────────

test('updatePassword: the new password authenticates and the old one does not', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db, 'swap@example.com', 'the old passphrase');
  await updatePassword(db, tenantId, 'the new passphrase');
  assert.equal(await authenticate(db, { email: 'swap@example.com', password: 'the old passphrase' }), null);
  assert.deepEqual(
    await authenticate(db, { email: 'swap@example.com', password: 'the new passphrase' }),
    { tenantId },
  );
});

test('updatePassword: a weak password is rejected and the old password still works', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db, 'weak@example.com', 'the old passphrase');
  await assert.rejects(
    updatePassword(db, tenantId, 'short'),
    (e) => e.code === 'weak_password',
  );
  assert.deepEqual(
    await authenticate(db, { email: 'weak@example.com', password: 'the old passphrase' }),
    { tenantId },
  );
  await assert.rejects(updatePassword(db, null, 'a long passphrase'), (e) => e.code === 'tenant_required');
});

// ─── lib/mailer.js ────────────────────────────────────────────────────────

test('mailer unconfigured: returns mailer_not_configured, never throws, never fetches', async () => {
  let calls = 0;
  const out = await withFetch(async () => { calls += 1; return { ok: true, status: 200 }; },
    () => sendPasswordResetEmail('reset@example.com', 'a'.repeat(64)));
  assert.deepEqual(out, { sent: false, reason: 'mailer_not_configured' });
  assert.equal(calls, 0);
});

test('mailer configured: POSTs the exact reset link to Resend and returns sent', async () => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  try {
    let seen = null;
    const token = 'b'.repeat(64);
    const out = await withFetch(async (url, opts) => {
      seen = { url, opts };
      return { ok: true, status: 200 };
    }, () => sendPasswordResetEmail('Reset@Example.com', token));
    assert.deepEqual(out, { sent: true });
    assert.equal(seen.url, 'https://api.resend.com/emails');
    assert.equal(seen.opts.method, 'POST');
    assert.equal(seen.opts.headers.Authorization, 'Bearer test-resend-key');
    const body = JSON.parse(seen.opts.body);
    assert.equal(body.from, 'Capstone Foundry <support@capstonefoundry.helmian.cloud>');
    assert.equal(body.to, 'Reset@Example.com');
    assert.equal(body.subject, 'Reset your Capstone Foundry password');
    assert.ok(body.text.includes(`https://thinkbuddy-sandy.vercel.app/#reset=${token}`));
    assert.equal(buildResetLink(token), `https://thinkbuddy-sandy.vercel.app/#reset=${token}`);
  } finally {
    delete process.env.RESEND_API_KEY;
  }
});

test('mailer: APP_BASE_URL and RESET_FROM overrides are honored', async () => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.APP_BASE_URL = 'https://preview.example.com';
  process.env.RESET_FROM = 'Support <help@example.com>';
  try {
    let body = null;
    const out = await withFetch(async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    }, () => sendPasswordResetEmail('reset@example.com', 'c'.repeat(64)));
    assert.deepEqual(out, { sent: true });
    assert.equal(body.from, 'Support <help@example.com>');
    assert.ok(body.text.includes(`https://preview.example.com/#reset=${'c'.repeat(64)}`));
  } finally {
    delete process.env.RESEND_API_KEY;
    delete process.env.APP_BASE_URL;
    delete process.env.RESET_FROM;
  }
});

test('mailer: provider failure and network failure both return sent:false, never throw', async () => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  try {
    const http = await withFetch(async () => ({ ok: false, status: 503 }),
      () => sendPasswordResetEmail('reset@example.com', 'd'.repeat(64)));
    assert.equal(http.sent, false);
    const boom = await withFetch(async () => { throw new Error('network down'); },
      () => sendPasswordResetEmail('reset@example.com', 'd'.repeat(64)));
    assert.deepEqual(boom, { sent: false, reason: 'send_failed' });
  } finally {
    delete process.env.RESEND_API_KEY;
  }
});

// ─── Handler: request-reset ───────────────────────────────────────────────

test('POST /api/auth/request-reset: identical 200 for known and unknown emails (no enumeration)', async () => {
  const db = new FakeDb();
  await account(db, 'known@example.com');
  const known = fakeRes();
  await handleAuth(post('/api/auth/request-reset', { email: 'known@example.com' }), known, db);
  const unknown = fakeRes();
  await handleAuth(post('/api/auth/request-reset', { email: 'ghost@example.com' }), unknown, db);
  assert.equal(known.statusCode, 200);
  assert.equal(unknown.statusCode, 200);
  assert.deepEqual(known.body, { ok: true });
  assert.deepEqual(unknown.body, known.body); // indistinguishable
  // Only the real account got a token row.
  assert.equal(db.rows.password_resets.length, 1);
  assert.equal(db.rows.password_resets[0].tenant_id, db.tenants[0].id);
});

test('POST /api/auth/request-reset with the mailer unconfigured still answers 200', async () => {
  const db = new FakeDb();
  await account(db, 'nomail@example.com');
  const res = fakeRes();
  await handleAuth(post('/api/auth/request-reset', { email: 'nomail@example.com' }), res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  // The token was still minted (it simply goes unemailed).
  assert.equal(db.rows.password_resets.length, 1);
});

test('end to end through the handler: the emailed link token confirms and the new password logs in', async () => {
  process.env.RESEND_API_KEY = 'test-resend-key';
  try {
    const db = new FakeDb();
    const { tenantId } = await account(db, 'flow@example.com', 'the old passphrase');
    let emailed = null;
    await withFetch(async (url, opts) => {
      emailed = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    }, async () => {
      const res = fakeRes();
      await handleAuth(post('/api/auth/request-reset', { email: 'flow@example.com' }), res, db);
      assert.equal(res.statusCode, 200);
    });
    const m = /#reset=([0-9a-f]{64})/.exec(emailed.text);
    assert.ok(m, 'the email body carries the reset link with the raw token');
    const confirm = fakeRes();
    await handleAuth(post('/api/auth/confirm-reset', { token: m[1], newPassword: 'the new passphrase' }), confirm, db);
    assert.equal(confirm.statusCode, 200);
    assert.deepEqual(confirm.body, { ok: true });
    assert.equal(await authenticate(db, { email: 'flow@example.com', password: 'the old passphrase' }), null);
    assert.deepEqual(
      await authenticate(db, { email: 'flow@example.com', password: 'the new passphrase' }),
      { tenantId },
    );
  } finally {
    delete process.env.RESEND_API_KEY;
  }
});

// ─── Handler: confirm-reset ───────────────────────────────────────────────

test('POST /api/auth/confirm-reset: happy path -> 200 { ok: true }', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db, 'happy@example.com');
  const { token } = await mintPasswordResetToken(db, tenantId);
  const res = fakeRes();
  await handleAuth(post('/api/auth/confirm-reset', { token, newPassword: 'a fresh passphrase' }), res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('POST /api/auth/confirm-reset: unknown token -> 400 invalid_or_expired_token', async () => {
  const db = new FakeDb();
  await account(db, 'bad@example.com');
  const res = fakeRes();
  await handleAuth(post('/api/auth/confirm-reset', { token: 'e'.repeat(64), newPassword: 'a fresh passphrase' }), res, db);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'invalid_or_expired_token' });
});

test('POST /api/auth/confirm-reset: weak password -> 400 and the token is NOT burned', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db, 'weak2@example.com');
  const { token } = await mintPasswordResetToken(db, tenantId);
  const weak = fakeRes();
  await handleAuth(post('/api/auth/confirm-reset', { token, newPassword: 'short' }), weak, db);
  assert.equal(weak.statusCode, 400);
  assert.deepEqual(weak.body, { error: 'weak_password' });
  const retry = fakeRes();
  await handleAuth(post('/api/auth/confirm-reset', { token, newPassword: 'a fresh passphrase' }), retry, db);
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.body, { ok: true });
});

test('POST /api/auth/reset (single-shim endpoint) dispatches by body shape', async () => {
  const db = new FakeDb();
  const { tenantId } = await account(db, 'shim@example.com');
  const req = fakeRes();
  await handleAuth(post('/api/auth/reset', { email: 'shim@example.com' }), req, db);
  assert.equal(req.statusCode, 200);
  assert.deepEqual(req.body, { ok: true });
  const { token } = await mintPasswordResetToken(db, tenantId);
  const confirm = fakeRes();
  await handleAuth(post('/api/auth/reset', { token, newPassword: 'a fresh passphrase' }), confirm, db);
  assert.equal(confirm.statusCode, 200);
  assert.deepEqual(confirm.body, { ok: true });
});

test('compat mode (no SESSION_SECRET) -> 503 accounts_not_configured on both reset routes', async () => {
  const db = new FakeDb();
  await account(db, 'compat@example.com');
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    for (const path of ['/api/auth/request-reset', '/api/auth/confirm-reset', '/api/auth/reset']) {
      const res = fakeRes();
      await handleAuth(post(path, { email: 'compat@example.com', token: 'x'.repeat(64), newPassword: 'a fresh passphrase' }), res, db);
      assert.equal(res.statusCode, 503, path);
      assert.deepEqual(res.body, { error: 'accounts_not_configured' }, path);
    }
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});

// Restore any env the host shell happened to carry (suite hygiene).
if (SAVED_RESEND !== undefined) process.env.RESEND_API_KEY = SAVED_RESEND;
if (SAVED_BASE !== undefined) process.env.APP_BASE_URL = SAVED_BASE;
if (SAVED_FROM !== undefined) process.env.RESET_FROM = SAVED_FROM;
