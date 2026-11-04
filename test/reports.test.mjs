// test/reports.test.mjs — store-readiness gap 2: in-app reporting
// for AI-generated content (Google Play's AI-content policy; table
// sql/store/009_content_reports.sql). Fake db, no live database.
// These tests pin: the stored record is built field-by-field from
// the kind's whitelist under the TOKEN's tenant (a body claiming
// another tenant_id is stripped); excerpt and reason are capped,
// never rejected for length; a bad kind / media URL / missing
// excerpt is a coded refusal at the lib level; the handler is no
// oracle — a signed-in POST answers { ok: true } whether the report
// stored or not; signed-out in enforced mode is a 401; and the
// router actually dispatches /api/safety-report to this handler.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildReportPayload, createReport, listReports,
  EXCERPT_CAP, REASON_CAP,
} from '../lib/reports.js';
import { signSession, LEGACY_TENANT_ID } from '../lib/tenant.js';
import { handleSafetyReport } from '../server/handlers/safety-report.js';
import router from '../api/[...path].js';
import { FakeDb } from './fake-db.mjs';

const SECRET = 'reports-test-secret';
process.env.SESSION_SECRET = SECRET;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

function fakeRes() {
  return {
    statusCode: null,
    body: null,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
    setHeader(k, v) { this.headers[k] = v; },
    end(s) { try { this.body = JSON.parse(s); } catch { this.body = s; } return this; },
  };
}

function authedReq(tenantId, { method = 'POST', body = {} } = {}) {
  return {
    method,
    url: 'http://local/api/safety-report',
    headers: { authorization: `Bearer ${signSession(tenantId, SECRET)}` },
    body,
  };
}

// ─── lib: payload building ──────────────────────────────────────────

test('media payload: URL kept, everything else stripped', () => {
  const built = buildReportPayload({
    kind: 'media',
    media_url: 'https://blob.example.com/thinkinbuddy/images/abc.png',
    tenant_id: TENANT_B,
    user_id: 'someone-else',
    plan: 'helmian_connect',
    excerpt: 'not part of a media report',
  });
  assert.deepEqual(built, {
    kind: 'media',
    media_url: 'https://blob.example.com/thinkinbuddy/images/abc.png',
    excerpt: null,
    reason: null,
  });
});

test('answer payload: excerpt capped at 2000, reason capped at 500', () => {
  const built = buildReportPayload({
    kind: 'answer',
    excerpt: 'x'.repeat(EXCERPT_CAP + 500),
    reason: 'y'.repeat(REASON_CAP + 100),
  });
  assert.equal(built.excerpt.length, EXCERPT_CAP);
  assert.equal(built.reason.length, REASON_CAP);
  assert.equal(built.media_url, null);
});

test('bad kind / bad media URL / missing excerpt are coded refusals', () => {
  assert.throws(() => buildReportPayload({ kind: 'user' }), (e) => e.code === 'invalid_kind');
  assert.throws(() => buildReportPayload({ kind: 'media' }), (e) => e.code === 'invalid_media_url');
  assert.throws(
    () => buildReportPayload({ kind: 'media', media_url: 'javascript:alert(1)' }),
    (e) => e.code === 'invalid_media_url',
  );
  assert.throws(() => buildReportPayload({ kind: 'answer', excerpt: '   ' }), (e) => e.code === 'invalid_field');
  assert.throws(() => buildReportPayload(null), (e) => e.code === 'invalid_field');
});

// ─── lib: storage + tenant scoping ──────────────────────────────────

test('createReport stores under the given tenant, never the body one', async () => {
  const db = new FakeDb();
  const row = await createReport(db, TENANT_A, {
    kind: 'answer',
    excerpt: 'the answer being reported',
    tenant_id: TENANT_B,
  });
  assert.equal(row.tenant_id, TENANT_A);
  assert.equal(row.user_id, TENANT_A);
  assert.equal(row.kind, 'answer');
  assert.equal((await listReports(db, TENANT_A)).length, 1);
  assert.equal((await listReports(db, TENANT_B)).length, 0);
});

// ─── handler ────────────────────────────────────────────────────────

test('handler: valid media report stores and answers ok', async () => {
  const db = new FakeDb();
  const res = fakeRes();
  await handleSafetyReport(authedReq(TENANT_A, {
    body: { kind: 'media', media_url: 'https://blob.example.com/v.mp4', reason: 'scary' },
  }), res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  const rows = await listReports(db, TENANT_A);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].media_url, 'https://blob.example.com/v.mp4');
  assert.equal(rows[0].reason, 'scary');
});

test('handler: invalid body still answers ok and stores nothing (no oracle)', async () => {
  const db = new FakeDb();
  const res = fakeRes();
  await handleSafetyReport(authedReq(TENANT_A, {
    body: { kind: 'media', media_url: 'not-a-url' },
  }), res, db);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal((await listReports(db, TENANT_A)).length, 0);
});

test('handler: no session in enforced mode is a 401', async () => {
  const db = new FakeDb();
  const res = fakeRes();
  await handleSafetyReport({
    method: 'POST', url: 'http://local/api/safety-report', headers: {},
    body: { kind: 'answer', excerpt: 'x' },
  }, res, db);
  assert.equal(res.statusCode, 401);
  assert.equal(db.rows.content_reports.length, 0);
});

test('handler: GET is a 405', async () => {
  const db = new FakeDb();
  const res = fakeRes();
  await handleSafetyReport(authedReq(TENANT_A, { method: 'GET' }), res, db);
  assert.equal(res.statusCode, 405);
});

test('handler: compat mode (no SESSION_SECRET) files under the legacy tenant', async () => {
  const saved = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  try {
    const db = new FakeDb();
    const res = fakeRes();
    await handleSafetyReport({
      method: 'POST', url: 'http://local/api/safety-report', headers: {},
      body: { kind: 'answer', excerpt: 'compat answer' },
    }, res, db);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true });
    assert.equal((await listReports(db, LEGACY_TENANT_ID)).length, 1);
  } finally {
    process.env.SESSION_SECRET = saved;
  }
});

// ─── routing pin ────────────────────────────────────────────────────

test('router dispatches /api/safety-report to the handler (401, not router 404)', async () => {
  const res = fakeRes();
  await router({
    method: 'POST', url: '/api/safety-report', headers: {},
    body: { kind: 'answer', excerpt: 'x' },
  }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

// ─── client contract (index.html) ───────────────────────────────────

test('index.html carries both report controls and the endpoint', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  assert.ok(html.includes('id="galleryLightboxReport"'), 'lightbox report button');
  assert.ok(html.includes('id="reportAnswerBtn"'), 'answer report button');
  assert.ok(html.includes('Report this'), 'media report label');
  assert.ok(html.includes('Report this answer'), 'answer report label');
  assert.ok(html.includes('/api/safety-report'), 'endpoint');
  assert.ok(html.includes("Thanks — reported. We'll review it."), 'thanks wording');
});
