// lib/accounts.js — email/password accounts for the Capstone Foundry store
// build (accounts bite). An account IS a tenant: signup inserts the
// tenants row (sql/store/004 adds email/password_hash/auth_provider to
// the bite-1 table) plus the empty profiles row onboarding will fill in
// (sql/store/001) plus a free entitlements row, and login verifies the
// password and returns the tenant id — the session token itself is
// minted by lib/tenant.js (signSession), this file owns identity only.
// It also owns ERASURE: deleteAccount() below wipes every tenant-scoped
// table and then the tenants row (Apple 5.1.1(v) / Play deletion rule).
//
// PASSWORD STORAGE: scrypt, per-account random salt, stored
// "salt:hash" (hex) — the same shape and timing-safe verification as the
// parent PIN in lib/safety.js. The password itself is never stored and
// never logged.
//
// PASSWORD POLICY: minimum 10 characters. This is a PARENT's account —
// it guards a child's buddy, the parent PIN settings, and the payment
// relationship — so the floor is a real passphrase length, not the
// 6-character minimum consumer apps tolerate. No composition rules
// (length beats "must contain a symbol" for actual security).
//
// NO ACCOUNT ENUMERATION: authenticate() returns the same null for an
// unknown email and for a wrong password, and runs a dummy scrypt
// verify for unknown emails so the response TIME does not leak which
// case it was either. The signup path necessarily reveals a taken email
// ({code:'email_taken'}) — that is the standard, accepted exception:
// you cannot create the account either way.
//
// DB access mirrors lib/usage.js: every DB function takes a pg
// Pool/client (or an async factory returning one) as its first argument
// so tests pass a fake. getAccountsDb() is the lazy shared-pool
// convenience for handlers and is never called by tests.
//
// ZERO new dependencies: node:crypto only.

import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getUsageDb } from './usage.js';

export const PASSWORD_MIN_LENGTH = 10;
export const AUTH_PROVIDER_EMAIL = 'email';

const SALT_BYTES = 16;
const HASH_KEY_LEN = 64;

function codedError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

async function resolveDb(db) {
  return typeof db === 'function' ? await db() : db;
}

function rowsOf(result) {
  if (Array.isArray(result)) return result;
  return result?.rows || [];
}

// ─── Email + password policy ──────────────────────────────────────────────

/**
 * Normalize + validate an email address. Returns the normalized
 * (trimmed, lowercased) address, or null when it is not a plausible
 * email. Deliberately a shape check, not an RFC parser: one '@', no
 * spaces, a dot in the domain, sane length.
 */
export function validateEmail(email) {
  if (typeof email !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

/** Password policy check: a string of at least PASSWORD_MIN_LENGTH chars. */
export function isValidPassword(password) {
  return typeof password === 'string' && password.length >= PASSWORD_MIN_LENGTH;
}

// ─── Password hashing (scrypt, "salt:hash" hex — cf. lib/safety.js) ───────

/**
 * Hash a password for storage (tenants.password_hash, sql/store/004).
 * @param {string} password
 * @returns {string} "salt:hash" (hex)
 */
export function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('hashPassword: password is required');
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, HASH_KEY_LEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

/**
 * Check a password against a stored hashPassword value. Timing-safe
 * (length check first — timingSafeEqual throws on a length mismatch).
 * @returns {boolean} false for a wrong password and for any malformed
 *   stored value. Never throws.
 */
export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const sep = stored.indexOf(':');
  if (sep <= 0) return false;
  const salt = Buffer.from(stored.slice(0, sep), 'hex');
  const expected = Buffer.from(stored.slice(sep + 1), 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

// A real hash of a throwaway password, computed once at module load.
// authenticate() verifies against this when the email is unknown, so
// unknown-email and wrong-password take the same scrypt time and the
// caller cannot tell them apart by timing (see the header).
const DUMMY_PASSWORD_HASH = hashPassword('dummy-password-for-timing-only');

// ─── Account operations ───────────────────────────────────────────────────

/**
 * Look a tenant up by email (normalized before lookup).
 * @returns {Promise<{ id: string, email: string, password_hash: string,
 *   auth_provider: string, status: string } | null>}
 */
export async function findTenantByEmail(db, email) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('findTenantByEmail: db (pg pool/client) required');
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized) return null;
  const result = await pool.query(
    `SELECT id, email, password_hash, auth_provider, status
       FROM tenants WHERE email = $1`,
    [normalized],
  );
  return rowsOf(result)[0] || null;
}

/**
 * Look a tenant up by id (the session token's tenantId — the deletion
 * route uses this to fetch the stored password hash for its
 * current-password check).
 * @returns {Promise<{ id: string, email: string, password_hash: string,
 *   auth_provider: string, status: string } | null>}
 */
export async function findTenantById(db, tenantId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('findTenantById: db (pg pool/client) required');
  if (!tenantId) return null;
  const result = await pool.query(
    `SELECT id, email, password_hash, auth_provider, status
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
  return rowsOf(result)[0] || null;
}

/**
 * Create one account: tenants row (status 'active', provider 'email')
 * + the account's first (primary, active) profiles row + free
 * entitlements row. The profile and entitlement are part of the
 * account, not later steps — every tenant always has an entitlement
 * and, since safety bite 9, a primary profile (the first of up to a
 * household of profiles, sql/store/007).
 * @param {import('pg').Pool | Function} db
 * @param {{ email: string, password: string }} input
 * @returns {Promise<{ tenantId: string }>}
 * @throws Error with .code 'invalid_email' | 'weak_password' | 'email_taken'
 */
export async function createAccount(db, { email, password } = {}) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('createAccount: db (pg pool/client) required');
  const normalized = validateEmail(email);
  if (!normalized) throw codedError('invalid_email', 'email is missing or malformed');
  if (!isValidPassword(password)) {
    throw codedError('weak_password', `password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  const tenantId = randomUUID();
  try {
    await pool.query(
      `INSERT INTO tenants (id, email, password_hash, auth_provider, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [tenantId, normalized, hashPassword(password), AUTH_PROVIDER_EMAIL],
    );
  } catch (e) {
    // Unique violation on the email index (sql/store/004) = the email
    // already has an account. Clean product error, not a raw pg error.
    if (e && (e.code === '23505' || /duplicate key|unique constraint/i.test(e.message || ''))) {
      throw codedError('email_taken', 'an account with this email already exists');
    }
    throw e;
  }
  await pool.query(
    `INSERT INTO profiles (tenant_id, profile_id, is_primary, is_active)
     VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, profile_id) DO NOTHING`,
    [tenantId, randomUUID(), true, true],
  );
  await pool.query(
    `INSERT INTO entitlements (tenant_id, plan, status) VALUES ($1, 'free', 'active')
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId],
  );
  return { tenantId };
}

/**
 * Verify an email/password pair.
 * @returns {Promise<{ tenantId: string } | null>} null for an unknown
 *   email, a wrong password, a malformed input, and a non-active
 *   tenant — identically, so the result never reveals which accounts
 *   exist (see the header on enumeration + the dummy verify).
 */
export async function authenticate(db, { email, password } = {}) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('authenticate: db (pg pool/client) required');
  if (typeof password !== 'string' || !password) return null;
  const row = await findTenantByEmail(pool, email);
  if (!row || !row.password_hash) {
    // Unknown email (or a provider-first account with no password):
    // burn the same scrypt time as a real verify, then the same null.
    verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }
  if (!verifyPassword(password, row.password_hash)) return null;
  if (row.status !== 'active') return null;
  return { tenantId: row.id };
}

export const ACCOUNT_STATUSES = ['active', 'suspended'];

/**
 * Set an account's status — the operator's block lever (Apple 1.2:
 * the ability to block abusive users from the service). 'suspended'
 * makes authenticate() refuse sign-in for the account (see above:
 * any non-active status returns the same null as a wrong password);
 * 'active' restores it. Operator-side only: no route exposes this —
 * it is run by us against the hosted database when a content report
 * (lib/reports.js) is upheld. A session token already issued stays
 * technically valid until it expires; suspension stops new sign-ins
 * and, with the report record, is the documented response path.
 * @throws Error with .code 'invalid_status' | 'tenant_required'
 */
export async function setAccountStatus(db, tenantId, status) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('setAccountStatus: db (pg pool/client) required');
  if (!tenantId) throw codedError('tenant_required', 'tenantId is required');
  if (!ACCOUNT_STATUSES.includes(status)) {
    throw codedError('invalid_status', `status must be one of: ${ACCOUNT_STATUSES.join(', ')}`);
  }
  const result = await pool.query(
    `UPDATE tenants SET status = $2 WHERE id = $1`,
    [tenantId, status],
  );
  return { tenantId, status, updated: result?.rowCount ?? rowsOf(result).length };
}

// ─── Password reset (sql/store/011, lib/mailer.js) ───────────────────────
//
// The token model mirrors lib/relay.js's pairing codes exactly: the
// raw token (32 random bytes, hex) is returned EXACTLY ONCE — by
// mintPasswordResetToken, to the handler, which hands it to the
// mailer — and only its SHA-256 hash is ever stored. A token is live
// for 30 minutes and single-use; minting a fresh one invalidates the
// tenant's previous unused tokens, so at most one live token exists
// per tenant. Consumption is a conditional UPDATE (WHERE used_at IS
// NULL), so two parallel confirms of the same token cannot both win.

export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** SHA-256 of a password reset token, as stored in password_resets. */
export function hashPasswordResetToken(token) {
  return createHash('sha256').update(String(token).trim()).digest('hex');
}

/**
 * Mint a password reset token for one tenant. Minting INVALIDATES the
 * tenant's previous unused tokens first (see the section header).
 * @returns {Promise<{ token: string, expiresAt: string }>} the raw
 *   token (emailed to the account holder once, never stored) and its
 *   ISO expiry.
 */
export async function mintPasswordResetToken(db, tenantId, now = new Date()) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('mintPasswordResetToken: db (pg pool/client) required');
  if (!tenantId) throw codedError('tenant_required', 'tenantId is required');
  const at = now instanceof Date ? now : new Date(now);
  const expiresAt = new Date(at.getTime() + PASSWORD_RESET_TTL_MS);
  const token = randomBytes(32).toString('hex');
  await pool.query(
    `UPDATE password_resets SET used_at = $2
      WHERE tenant_id = $1 AND used_at IS NULL`,
    [tenantId, at.toISOString()],
  );
  await pool.query(
    `INSERT INTO password_resets (id, tenant_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), tenantId, hashPasswordResetToken(token), expiresAt.toISOString()],
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

/**
 * Consume a password reset token (single-use).
 * @returns {Promise<string | null>} the tenant id the token was minted
 *   for, or null for an unknown, expired, already-used, or ambiguous
 *   token — identically, so the result never reveals which case it
 *   was. Fails closed, like lib/relay.js redeemPairingCode.
 */
export async function consumePasswordResetToken(db, token, now = new Date()) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('consumePasswordResetToken: db (pg pool/client) required');
  if (typeof token !== 'string' || !token.trim()) return null;
  const at = now instanceof Date ? now : new Date(now);
  const result = await pool.query(
    `SELECT id, tenant_id FROM password_resets
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > $2`,
    [hashPasswordResetToken(token), at.toISOString()],
  );
  const found = rowsOf(result);
  if (found.length !== 1) return null;
  const { id, tenant_id: tenantId } = found[0];
  const consumed = await pool.query(
    `UPDATE password_resets SET used_at = $2
      WHERE id = $1 AND used_at IS NULL`,
    [id, at.toISOString()],
  );
  if (consumed && typeof consumed.rowCount === 'number' && consumed.rowCount === 0) {
    return null; // lost a race with a parallel consume of the same token
  }
  return tenantId;
}

/**
 * Set a tenant's password (the confirm half of the reset flow; also
 * the only password-write path besides signup). Validates the house
 * policy first — callers check the policy BEFORE consuming a reset
 * token so a weak attempt never burns the token.
 * @throws Error with .code 'tenant_required' | 'weak_password'
 */
export async function updatePassword(db, tenantId, newPassword) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('updatePassword: db (pg pool/client) required');
  if (!tenantId) throw codedError('tenant_required', 'tenantId is required');
  if (!isValidPassword(newPassword)) {
    throw codedError('weak_password', `password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  const result = await pool.query(
    `UPDATE tenants SET password_hash = $2 WHERE id = $1`,
    [tenantId, hashPassword(newPassword)],
  );
  return { tenantId, updated: result?.rowCount ?? rowsOf(result).length };
}

// ─── Account deletion (Apple 5.1.1(v) / Play account-deletion rule) ──────
//
// Deleting an account erases the tenant's data, table by table, then
// the tenants row itself. The store tables (001/003/005) are keyed by
// tenant_id and most also carry ON DELETE CASCADE — the explicit
// DELETEs here do not rely on the cascades: they make the erasure
// complete on databases where a cascade was never applied, they cover
// the legacy tables from sql/store/002 (memory_items,
// conversation_sessions/turns, actionable_*) whose tenant_id foreign
// keys have NO cascade, and they return per-table counts so callers
// and tests can prove what went away.
//
// ORDER: children before parents, and conversation_turns before
// conversation_sessions (turns reference their session). The tenants
// row goes LAST — if anything fails midway, the account still exists,
// nothing is half-deleted behind a success response, and the user can
// simply retry (every statement is tenant-scoped, so a retry is a
// no-op for tables already cleared).
//
// OPTIONAL tables: memory/conversation/actionable only exist when
// their setup scripts ran (002 guards on existence for the same
// reason). A missing one (pg 42P01 undefined_table) is skipped, not
// fatal. The store tables are NOT optional: an accounts database
// without them cannot have created the account in the first place.
//
// NOT deleted, deliberately: processed_billing_events (003) — the
// webhook audit trail is a billing record, retained for
// accounting/dispute purposes (the privacy policy says so); it holds
// event ids and plan names, not content. helmion_relay rows keep no
// tenant data either: 005 keys their tenant_id ON DELETE SET NULL.

/** Store tables that must exist on any accounts database. */
export const ACCOUNT_CORE_TABLES = [
  'relay_pairing_codes',
  'relay_devices',
  'tenant_credit_grants',
  'usage_ledger',
  'user_keys',
  'entitlements',
  'profiles',
];

/** Legacy/feature tables (sql/store/002) — present only when their
 *  setup script ran, so a missing table is skipped, never fatal. */
export const ACCOUNT_OPTIONAL_TABLES = [
  'password_resets',
  'conversation_turns',
  'conversation_sessions',
  'memory_items',
  'actionable_items',
  'actionable_entries',
  'actionable_connections',
  'actionable_google_accounts',
  'actionable_settings',
  'actionable_projects',
];

/**
 * Erase one tenant completely: every tenant-scoped row in the core and
 * optional tables, then the tenants row.
 * @param {import('pg').Pool | Function} db
 * @param {string} tenantId
 * @returns {Promise<{ tenantId: string, deletedRows: Object<string, number> }>}
 *   deletedRows counts per table ('tenants' included); optional tables
 *   that do not exist count as 0.
 * @throws Error with .code 'tenant_required' when tenantId is missing.
 */
export async function deleteAccount(db, tenantId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('deleteAccount: db (pg pool/client) required');
  if (!tenantId) throw codedError('tenant_required', 'tenantId is required');
  const deletedRows = {};
  const wipe = async (table, optional) => {
    try {
      const result = await pool.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
      deletedRows[table] = result?.rowCount ?? rowsOf(result).length;
    } catch (e) {
      if (optional && e && e.code === '42P01') { deletedRows[table] = 0; return; }
      throw e;
    }
  };
  for (const table of ACCOUNT_OPTIONAL_TABLES) await wipe(table, true);
  for (const table of ACCOUNT_CORE_TABLES) await wipe(table, false);
  const result = await pool.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  deletedRows.tenants = result?.rowCount ?? rowsOf(result).length;
  return { tenantId, deletedRows };
}

let _pool = null;

/**
 * Lazily build the shared pg pool for account handlers. The accounts
 * tables live in the same database as everything else (001's header),
 * so this delegates to lib/usage.js's pool factory — one pool config,
 * one place. Never called by tests.
 */
export async function getAccountsDb() {
  if (_pool) return _pool;
  _pool = await getUsageDb();
  return _pool;
}
