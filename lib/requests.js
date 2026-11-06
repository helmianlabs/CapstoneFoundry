// lib/requests.js — the unified request box for Capstone Foundry
// store build (requests bite B1; design: curriculum-requests-spec.md
// §1–§2 in ~/workspace/thinkinbuddy-launch/, generalizing the
// provider-inventory §5 intake before any of it was built).
//
// ONE table (sql/store/006_requests.sql), TWO kinds:
//   provider   — "a tool or AI service we don't have":
//                { provider_name, capability, use_case }
//   curriculum — "a subject to learn":
//                { role, subject, level, goal, source_links? }
//
// A request is a SUGGESTION BOX, NOT A CONTROL SURFACE. The payload
// is built field-by-field from the kind's whitelist — anything else
// in the body (tenant_id, status, plan, bucket, safety fields, …) is
// stripped, never stored — so a request can never reach the tenant's
// plan, credit bucket, or profile safety decision. Status starts at
// 'new' and moves ONLY through setRequestStatus below, which refuses
// every actor except the operator: the requester's API surface
// (server/handlers/requests.js) exposes create + read and nothing
// else. Troy works statuses from his desk (spec §6 bite B4).
//
// Status pipeline (spec §1.2 — one vocabulary, both kinds):
//   new (Received) → listed (On the list) → building (Being built)
//   → verifying (In verification — CURRICULUM KIND ONLY)
//   → shipped (Added); not_planned (Not planned) is the honest no,
//   reachable from any live state. Nothing moves backward; shipped
//   and not_planned are terminal. A curriculum may ship ONLY from
//   verifying — no curriculum ships unverified (spec §3/§4). A
//   provider skips verifying entirely (its proof is the wiring
//   bite's tests + the account sitting, spec §1.2).
//
// DB access mirrors lib/profile.js: functions take a pg Pool/client
// (or an async factory returning one) so tests pass a fake.
// getRequestsDb() is the lazy shared-pool convenience for handlers
// and is never called by tests.

import { getUsageDb } from './usage.js';

export const REQUEST_KINDS = ['provider', 'curriculum'];

export const PROVIDER_CAPABILITIES = ['chat', 'image', 'video', 'voice', 'other'];

/** Curriculum requester roles (spec §2). */
export const CURRICULUM_ROLES = ['parent', 'teacher', 'educator', 'student', 'other'];

/**
 * Curriculum levels (spec §2): the product's AGE_BANDS minus 'child'
 * (no curriculum serves it today), plus 'college' as a requestable
 * level — college curricula serve the adult band; there is no
 * 'college' profile band and this list does not invent one.
 */
export const CURRICULUM_LEVELS = ['6-8', '9-12', '13-17', 'college', 'adult'];

export const REQUEST_STATUSES = ['new', 'listed', 'building', 'verifying', 'shipped', 'not_planned'];

/** DB status → the plain words the requester sees (spec §1.2). */
export const STATUS_LABELS = {
  new: 'Received',
  listed: 'On the list',
  building: 'Being built',
  verifying: 'In verification',
  shipped: 'Added',
  not_planned: 'Not planned',
};

export const PROVIDER_FIELDS = ['provider_name', 'capability', 'use_case'];
export const CURRICULUM_FIELDS = ['role', 'subject', 'level', 'goal', 'source_links'];

// Length caps (spec §2 pins subject ≤ 80, goal ≤ 300, ≤ 3 links;
// provider §5 says "length caps on every field" without numbers —
// provider_name takes 120 and use_case mirrors goal's 300).
const CAPS = { provider_name: 120, subject: 80, use_case: 300, goal: 300, source_link: 500 };
const MAX_SOURCE_LINKS = 3;

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

function cleanText(value, field, max) {
  if (typeof value !== 'string') {
    throw codedError('invalid_field', `${field} must be a string`);
  }
  const text = value.trim();
  if (!text) throw codedError('invalid_field', `${field} is required`);
  if (text.length > max) throw codedError('invalid_field', `${field} must be at most ${max} characters`);
  return text;
}

function cleanSourceLinks(value) {
  if (!Array.isArray(value) || value.length > MAX_SOURCE_LINKS) {
    throw codedError('invalid_source_links', `source_links must be an array of at most ${MAX_SOURCE_LINKS} URLs`);
  }
  return value.map((link) => {
    if (typeof link !== 'string' || link.length > CAPS.source_link) {
      throw codedError('invalid_source_links', 'each source link must be a URL string');
    }
    let url;
    try {
      url = new URL(link.trim());
    } catch {
      throw codedError('invalid_source_links', 'each source link must be a valid URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw codedError('invalid_source_links', 'source links must be http(s) URLs');
    }
    return url.toString();
  });
}

/**
 * Validate a POST body and build the EXACT payload that gets stored:
 * the kind's whitelisted fields and nothing else. Unknown top-level
 * fields are stripped (the codebase's habit — upsertProfile ignores
 * non-whitelisted fields the same way); unknown kind / capability /
 * role / level, a missing required field, or an oversized field is a
 * coded error the handler maps to 400, and nothing is stored.
 *
 * @param {object} body  the request body ({ kind, ...kind fields })
 * @returns {{ kind: string, payload: object }}
 * @throws Error with .code 'invalid_kind' | 'invalid_capability' |
 *   'invalid_role' | 'invalid_level' | 'invalid_source_links' |
 *   'invalid_field'
 */
export function buildRequestPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw codedError('invalid_field', 'a request body is required');
  }
  const kind = body.kind;
  if (!REQUEST_KINDS.includes(kind)) {
    throw codedError('invalid_kind', `kind must be one of: ${REQUEST_KINDS.join(', ')}`);
  }
  if (kind === 'provider') {
    const provider_name = cleanText(body.provider_name, 'provider_name', CAPS.provider_name);
    if (!PROVIDER_CAPABILITIES.includes(body.capability)) {
      throw codedError('invalid_capability', `capability must be one of: ${PROVIDER_CAPABILITIES.join(', ')}`);
    }
    const use_case = cleanText(body.use_case, 'use_case', CAPS.use_case);
    return { kind, payload: { provider_name, capability: body.capability, use_case } };
  }
  // curriculum
  if (!CURRICULUM_ROLES.includes(body.role)) {
    throw codedError('invalid_role', `role must be one of: ${CURRICULUM_ROLES.join(', ')}`);
  }
  const subject = cleanText(body.subject, 'subject', CAPS.subject);
  if (!CURRICULUM_LEVELS.includes(body.level)) {
    throw codedError('invalid_level', `level must be one of: ${CURRICULUM_LEVELS.join(', ')}`);
  }
  const goal = cleanText(body.goal, 'goal', CAPS.goal);
  const payload = { role: body.role, subject, level: body.level, goal };
  if (body.source_links !== undefined && body.source_links !== null) {
    const links = cleanSourceLinks(body.source_links);
    if (links.length) payload.source_links = links;
  }
  return { kind, payload };
}

/**
 * Store one request for a tenant. The tenant comes from the caller
 * (the handler resolves it from the session token) — never from the
 * body; buildRequestPayload strips any tenant_id the body claimed.
 * Status always starts 'new'; there is no way to create a request in
 * any other state.
 * @returns {Promise<object>} the stored row
 */
export async function createRequest(db, tenantId, body) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('createRequest: db (pg pool/client) required');
  if (!tenantId) throw new Error('createRequest: tenantId required');
  const { kind, payload } = buildRequestPayload(body);
  const result = await pool.query(
    `INSERT INTO requests (tenant_id, kind, payload, status)
     VALUES ($1, $2, $3, 'new')
     RETURNING id, tenant_id, kind, payload, status, created_at`,
    [tenantId, kind, JSON.stringify(payload)],
  );
  return rowsOf(result)[0] || null;
}

/** One request row by id (any tenant — operator-side reads only). */
export async function getRequest(db, id) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('getRequest: db (pg pool/client) required');
  if (!id) return null;
  const result = await pool.query(
    `SELECT id, tenant_id, kind, payload, status, created_at
       FROM requests WHERE id = $1`,
    [id],
  );
  return rowsOf(result)[0] || null;
}

/** The tenant's own requests, newest first. The only list a requester ever sees. */
export async function listRequests(db, tenantId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('listRequests: db (pg pool/client) required');
  if (!tenantId) return [];
  const result = await pool.query(
    `SELECT id, tenant_id, kind, payload, status, created_at
       FROM requests WHERE tenant_id = $1
      ORDER BY created_at DESC, id DESC`,
    [tenantId],
  );
  return rowsOf(result);
}

// ─── Status transitions — operator only ─────────────────────────────

const CHAIN = ['new', 'listed', 'building', 'verifying', 'shipped'];
const TERMINAL = ['shipped', 'not_planned'];

/**
 * Is this status move legal for this kind? Pure rule, no db — the
 * single place the §1.2 pipeline is encoded:
 *  - nothing moves backward, nothing leaves a terminal state;
 *  - 'verifying' is curriculum-only, entered from 'building';
 *  - curriculum reaches 'shipped' ONLY from 'verifying' (no
 *    curriculum ships unverified); provider reaches 'shipped' from
 *    'building' onward (it skips verifying entirely);
 *  - 'not_planned' is reachable from any live state.
 */
export function canTransition(kind, from, to) {
  if (!REQUEST_STATUSES.includes(from) || !REQUEST_STATUSES.includes(to)) return false;
  if (from === to) return false;
  if (TERMINAL.includes(from)) return false;
  if (to === 'not_planned') return true;
  if (to === 'verifying') return kind === 'curriculum' && from === 'building';
  if (to === 'shipped') {
    if (kind === 'curriculum') return from === 'verifying';
    return CHAIN.indexOf(from) >= CHAIN.indexOf('building');
  }
  const fi = CHAIN.indexOf(from);
  const ti = CHAIN.indexOf(to);
  return fi >= 0 && ti > fi;
}

/**
 * Move one request's status. OPERATOR ONLY: `actor` must be the
 * string 'operator' (Troy's desk, spec §6 B4) — a requester moving
 * their own request is refused before the row is even read, so the
 * terminal states (Added / Not planned) can never be self-awarded.
 * @returns {Promise<object>} the row after the move
 * @throws Error with .code 'forbidden' | 'not_found' | 'invalid_transition'
 */
export async function setRequestStatus(db, id, next, { actor } = {}) {
  if (actor !== 'operator') {
    throw codedError('forbidden', 'only the operator may move a request');
  }
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('setRequestStatus: db (pg pool/client) required');
  const row = await getRequest(pool, id);
  if (!row) throw codedError('not_found', 'no such request');
  if (!canTransition(row.kind, row.status, next)) {
    throw codedError('invalid_transition', `a ${row.kind} request cannot move ${row.status} -> ${next}`);
  }
  const result = await pool.query(
    `UPDATE requests SET status = $1 WHERE id = $2
     RETURNING id, tenant_id, kind, payload, status, created_at`,
    [next, id],
  );
  return rowsOf(result)[0] || getRequest(pool, id);
}

let _pool = null;

/**
 * Lazily build the shared pg pool for request reads/writes (the same
 * database as everything else — 001's header), delegating to
 * lib/usage.js's pool factory. Handlers pass this function itself
 * into the data functions (the factory form), so the pool is only
 * built when a request is actually read or written — never in tests.
 */
export async function getRequestsDb() {
  if (_pool) return _pool;
  _pool = await getUsageDb();
  return _pool;
}
