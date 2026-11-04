// lib/reports.js — in-app reporting for AI-generated content
// (store-readiness gap 2; table: sql/store/009_content_reports.sql).
//
// Google Play's AI-generated content policy requires an in-app way
// to flag or report offensive AI-generated content; Apple expects
// the same. The app is voice-first — there are no chat bubbles — so
// the two report surfaces are the ones the settled design named:
//   media  — "Report this" in the media gallery's lightbox, carrying
//            the item's URL;
//   answer — "Report this answer" beside the transcript, carrying
//            the last answer the client holds as an excerpt.
//
// A report is a FLAG FOR HUMAN REVIEW, NOT A CONTROL SURFACE. The
// payload is built field-by-field from the kind's whitelist —
// anything else in the body (tenant_id, user_id, plan, safety
// fields, …) is stripped, never stored — so a report can never
// reach the tenant's plan, credit bucket, or profile safety
// decision, and filing one changes nothing by itself. Review is a
// human reading rows from this table; there is deliberately no
// status pipeline and no API verb that acts on a report.
//
// DB access mirrors lib/requests.js: functions take a pg Pool/client
// (or an async factory returning one) so tests pass a fake.
// getReportsDb() is the lazy shared-pool convenience for handlers
// and is never called by tests.

import { getUsageDb } from './usage.js';

export const REPORT_KINDS = ['media', 'answer'];

/** The stored excerpt never exceeds this, however long the answer was. */
export const EXCERPT_CAP = 2000;

/** The reporter's optional reason, in their own words. */
export const REASON_CAP = 500;

/** Media URLs are gallery Blob URLs; anything longer is not one. */
export const MEDIA_URL_CAP = 2048;

async function resolveDb(db) {
  return typeof db === 'function' ? await db() : db;
}

function rowsOf(result) {
  if (Array.isArray(result)) return result;
  return result?.rows || [];
}

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function cleanMediaUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw codedError('invalid_media_url', 'media_url is required for a media report');
  }
  const text = value.trim();
  if (text.length > MEDIA_URL_CAP) {
    throw codedError('invalid_media_url', `media_url must be at most ${MEDIA_URL_CAP} characters`);
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    throw codedError('invalid_media_url', 'media_url must be a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw codedError('invalid_media_url', 'media_url must be an http(s) URL');
  }
  return url.toString();
}

function cleanExcerpt(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw codedError('invalid_field', 'excerpt is required for an answer report');
  }
  // Capped, not rejected: the excerpt is evidence for a reviewer,
  // and the first 2000 characters of a long answer carry it.
  return value.trim().slice(0, EXCERPT_CAP);
}

function cleanReason(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw codedError('invalid_field', 'reason must be a string');
  }
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, REASON_CAP);
}

/**
 * Validate a POST body and build the EXACT record that gets stored:
 * the kind's whitelisted fields and nothing else. Unknown top-level
 * fields are stripped (the codebase's habit — buildRequestPayload
 * does the same); an unknown kind, a missing required field, or a
 * bad media URL is a coded error and nothing is stored.
 *
 * @param {object} body  the request body ({ kind, ...kind fields })
 * @returns {{ kind: string, media_url: string|null,
 *   excerpt: string|null, reason: string|null }}
 * @throws Error with .code 'invalid_kind' | 'invalid_media_url' |
 *   'invalid_field'
 */
export function buildReportPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw codedError('invalid_field', 'a report body is required');
  }
  const kind = body.kind;
  if (!REPORT_KINDS.includes(kind)) {
    throw codedError('invalid_kind', `kind must be one of: ${REPORT_KINDS.join(', ')}`);
  }
  const reason = cleanReason(body.reason);
  if (kind === 'media') {
    return { kind, media_url: cleanMediaUrl(body.media_url), excerpt: null, reason };
  }
  // answer
  return { kind, media_url: null, excerpt: cleanExcerpt(body.excerpt), reason };
}

/**
 * Store one report for a tenant. The tenant comes from the caller
 * (the handler resolves it from the session token) — never from the
 * body; buildReportPayload strips any tenant_id the body claimed.
 * user_id records the same resolved identity: in the hosted data
 * model the tenant id IS the user identity the client carries (see
 * lib/tenant.js resolveScopedRequestIdentity); the column exists so
 * a future per-user split has somewhere to land.
 * @returns {Promise<object>} the stored row
 */
export async function createReport(db, tenantId, body) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('createReport: db (pg pool/client) required');
  if (!tenantId) throw new Error('createReport: tenantId required');
  const report = buildReportPayload(body);
  const result = await pool.query(
    `INSERT INTO content_reports (tenant_id, user_id, kind, media_url, excerpt, reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, tenant_id, user_id, kind, media_url, excerpt, reason, created_at`,
    [tenantId, tenantId, report.kind, report.media_url, report.excerpt, report.reason],
  );
  return rowsOf(result)[0] || null;
}

/** The tenant's filed reports, newest first (review-side read). */
export async function listReports(db, tenantId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('listReports: db (pg pool/client) required');
  if (!tenantId) return [];
  const result = await pool.query(
    `SELECT id, tenant_id, user_id, kind, media_url, excerpt, reason, created_at
       FROM content_reports WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC`,
    [tenantId],
  );
  return rowsOf(result);
}

let _pool = null;

/**
 * Lazily build the shared pg pool for report reads/writes (the same
 * database as everything else), delegating to lib/usage.js's pool
 * factory. Handlers pass this function itself into the data
 * functions (the factory form), so the pool is only built when a
 * report is actually filed — never in tests.
 */
export async function getReportsDb() {
  if (_pool) return _pool;
  _pool = await getUsageDb();
  return _pool;
}
