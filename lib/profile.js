// lib/profile.js — tenant profiles for the ThinkinBuddy store build
// (accounts bite). The profile (sql/store/001: display_name, age_band,
// about_me, safety_mode, parent_pin_hash) is the ONLY "config" a user
// ever fills in, and as of this bite it is also the SAFETY AUTHORITY:
// the paid handlers (chat, speak, image, video) resolve safety through
// resolveProfileSafety() below — profileSafety() applied to the
// tenant's profile row, with a fail-closed safe default when the
// profile cannot decide — replacing the request-supplied safety
// inputs the safety bite had to settle for.
//
// Safety bite 9 (safety-gap-map §7) makes profiles PLURAL: one account
// (tenant) holds a household of profiles (sql/store/007: profile_id,
// is_primary, is_active; primary key (tenant_id, profile_id)). Each
// profile has its own age_band and safety_mode. The tenant's first
// profile is its PRIMARY profile; the profile sessions run under is
// the tenant's ACTIVE profile, a server-side pointer the account
// holder moves with setActiveProfile() — never a field a request
// body can set on the session/tool paths (every handler resolves
// with resolveProfileSafety(db, tenantId) and gets the active
// profile; the resolver's optional explicit profileId is for the
// profile routes and tests, and is always validated against the
// tenant — a foreign or missing id resolves to the safe default,
// never to a sibling profile). Accounts from before bite 9 have
// exactly one profile, which the 007 backfill flags primary AND
// active, so their behavior is unchanged. The parent PIN stays an
// ACCOUNT-level lock: its hash lives on the primary profile's row
// and setParentPin/verifyParentPin below are tenant-scoped, exactly
// as before — child profiles never carry a PIN of their own.
// Troy's PIN rule lives here too: once a parent PIN is set, turning
// safety_mode OFF requires that PIN (enforced in server/handlers/
// profile.js, using verifyParentPin below) — and as of safety bite 8
// the same handler enforces the other half with setParentPin below:
// safety_mode cannot be turned ON while no PIN hash exists unless
// the write itself carries a PIN, which is hashed and stored as part
// of that operation. A safety-on profile is therefore always a
// PIN-locked profile; the resolver (resolveProfileSafety below) is
// deliberately NOT part of this — it decides from safety_mode and
// age_band exactly as before.
//
// AGE_BANDS aligns with lib/safety.js isMinorAgeBand semantics: 'child',
// '6-8' and '9-12' are minor bands (fail-closed moderation + kid safety
// core); '13-17' starts at 13 and 'adult' is adult — neither is minor
// under the documented COPPA under-13 rule. Keep the two files'
// semantics in lockstep: a band added here must mean the same thing in
// isMinorAgeBand.
//
// DB access mirrors lib/usage.js: DB functions take a pg Pool/client
// (or an async factory returning one) as the first argument so tests
// pass a fake. getProfileDb() is the lazy shared-pool convenience for
// handlers and is never called by tests.

import { randomUUID } from 'node:crypto';
import { hashPin, verifyPin, safetyDecision } from './safety.js';
import { getUsageDb } from './usage.js';

/** The age bands onboarding offers, narrowest first. */
export const AGE_BANDS = ['child', '6-8', '9-12', '13-17', 'adult'];

/** The only profile fields a client may write via upsertProfile. */
export const PROFILE_FIELDS = ['display_name', 'age_band', 'about_me', 'safety_mode'];

/**
 * Household size: how many profiles one account may hold in total
 * (the primary profile counts — it is one of the household's buddy
 * users). This is the settled DEFAULT (up to 4 per household);
 * plan-specific counts (e.g. Starter carries 2) belong to the
 * billing/entitlement layer and re-point this limit when they land —
 * no plan logic lives here.
 */
export const PROFILES_PER_TENANT_LIMIT = 4;

/** Every column a profiles row carries (sql/store/001 + 007). */
const PROFILE_COLUMNS = `tenant_id, profile_id, display_name, age_band, about_me,
            safety_mode, parent_pin_hash, is_primary, is_active,
            created_at, updated_at`;

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

/**
 * The tenant's ACTIVE profile row (all columns, including
 * parent_pin_hash — callers that SERIALIZE a profile must whitelist
 * fields, see server/handlers/profile.js), or null when the tenant
 * has none. This is the row sessions run under: the is_active row,
 * falling back to the primary, then to the earliest row (a tenant
 * whose rows predate the 007 flags still resolves to its one row).
 */
export async function getProfile(db, tenantId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('getProfile: db (pg pool/client) required');
  if (!tenantId) return null;
  const result = await pool.query(
    `SELECT ${PROFILE_COLUMNS}
       FROM profiles WHERE tenant_id = $1
       ORDER BY is_active DESC, is_primary DESC, created_at ASC
       LIMIT 1`,
    [tenantId],
  );
  return rowsOf(result)[0] || null;
}

/**
 * One named profile of the tenant, by its profile_id — or null when
 * this tenant has no profile with that id. The lookup is scoped by
 * tenant_id, so another tenant's profile_id resolves to null here,
 * never to that tenant's row (and never to a sibling of the named
 * profile either).
 */
export async function getProfileById(db, tenantId, profileId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('getProfileById: db (pg pool/client) required');
  if (!tenantId || !profileId) return null;
  const result = await pool.query(
    `SELECT ${PROFILE_COLUMNS}
       FROM profiles WHERE tenant_id = $1 AND profile_id = $2`,
    [tenantId, profileId],
  );
  return rowsOf(result)[0] || null;
}

/**
 * The tenant's PRIMARY profile (its first profile — the account-level
 * row that carries the parent PIN hash), or null when the tenant has
 * no profile. Falls back to the ordered active pick when no row is
 * flagged primary (a store that predates the 007 flags).
 */
export async function getPrimaryProfile(db, tenantId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('getPrimaryProfile: db (pg pool/client) required');
  if (!tenantId) return null;
  const result = await pool.query(
    `SELECT ${PROFILE_COLUMNS}
       FROM profiles WHERE tenant_id = $1 AND is_primary = true
       ORDER BY created_at ASC
       LIMIT 1`,
    [tenantId],
  );
  return rowsOf(result)[0] || getProfile(pool, tenantId);
}

/**
 * All of the tenant's profiles, in a DETERMINISTIC order: the
 * primary profile first, then first-created first, with profile_id
 * as the final tiebreak. created_at has millisecond precision, so
 * two profiles created in the same millisecond tie on it — without
 * is_primary leading, that tie used to fall straight to the random
 * profile_id order and the primary could list second (the flake
 * play-prep pass 1 caught). With all three terms the order is a
 * pure function of the rows, identical on every call.
 */
export async function listProfiles(db, tenantId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('listProfiles: db (pg pool/client) required');
  if (!tenantId) return [];
  const result = await pool.query(
    `SELECT ${PROFILE_COLUMNS}
       FROM profiles WHERE tenant_id = $1
       ORDER BY is_primary DESC, created_at ASC, profile_id ASC`,
    [tenantId],
  );
  return rowsOf(result);
}

/**
 * Whether the ACCOUNT has a parent PIN set. The lock is account-level
 * (bite 9): the hash lives on the primary profile's row, so this is
 * true no matter which of the tenant's profiles is active or being
 * edited — a child profile's own (always null) parent_pin_hash must
 * never be read as "no PIN protects this account."
 */
export async function hasParentPin(db, tenantId) {
  const primary = await getPrimaryProfile(db, tenantId);
  return Boolean(primary?.parent_pin_hash);
}

/**
 * Validate + pick the client-writable fields out of a fields object.
 * Anything not in PROFILE_FIELDS (parent_pin_hash, password_hash,
 * tenant_id, profile_id, …) is IGNORED, so a client can never write
 * credential material or identity through the profile path. The PIN
 * changes only via setParentPin.
 * @throws Error with .code 'invalid_age_band' | 'invalid_field'
 */
function cleanProfileFields(fields = {}) {
  const clean = {};
  for (const field of PROFILE_FIELDS) {
    if (fields[field] === undefined) continue;
    const value = fields[field];
    if (field === 'age_band' && value !== null && !AGE_BANDS.includes(value)) {
      throw codedError('invalid_age_band', `age_band must be one of: ${AGE_BANDS.join(', ')}`);
    }
    if (field === 'safety_mode' && value !== null && typeof value !== 'boolean') {
      throw codedError('invalid_field', 'safety_mode must be a boolean');
    }
    if ((field === 'display_name' || field === 'about_me') && value !== null && typeof value !== 'string') {
      throw codedError('invalid_field', `${field} must be a string`);
    }
    clean[field] = value;
  }
  return clean;
}

/**
 * Create-or-update one of the tenant's profiles from the whitelisted
 * fields only (see cleanProfileFields). The target profile is the one
 * named by `profileId`; with no profileId it is the tenant's ACTIVE
 * profile — the pre-bite-9 meaning of "the profile," so every
 * existing caller behaves exactly as before. A tenant with no profile
 * at all gains its primary (and active) profile from the write, as
 * before. A named profileId that is not this tenant's writes NOTHING
 * and throws 'profile_not_found' — an upsert must never silently
 * retarget to a sibling.
 * @returns {Promise<object>} the profile row after the write
 * @throws Error with .code 'invalid_age_band' | 'invalid_field' |
 *   'profile_not_found'
 */
export async function upsertProfile(db, tenantId, fields = {}, profileId = null) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('upsertProfile: db (pg pool/client) required');
  if (!tenantId) throw new Error('upsertProfile: tenantId required');
  const clean = cleanProfileFields(fields);
  let targetId = profileId;
  if (targetId) {
    const target = await getProfileById(pool, tenantId, targetId);
    if (!target) throw codedError('profile_not_found', 'no profile with that id belongs to this tenant');
  } else {
    targetId = (await getProfile(pool, tenantId))?.profile_id ?? null;
  }
  if (Object.keys(clean).length === 0) {
    return targetId ? getProfileById(pool, tenantId, targetId) : getProfile(pool, tenantId);
  }
  const isFirst = !targetId;
  const cols = Object.keys(clean);
  const allCols = ['tenant_id', 'profile_id', 'is_primary', 'is_active', ...cols];
  const values = [tenantId, targetId ?? randomUUID(), isFirst, isFirst, ...cols.map((c) => clean[c])];
  const placeholders = allCols.map((_, i) => `$${i + 1}`);
  const updates = cols.map((c) => `${c} = EXCLUDED.${c}`);
  const result = await pool.query(
    `INSERT INTO profiles (${allCols.join(', ')})
     VALUES (${placeholders.join(', ')})
     ON CONFLICT (tenant_id, profile_id) DO UPDATE SET ${updates.join(', ')}, updated_at = now()
     RETURNING ${PROFILE_COLUMNS}`,
    values,
  );
  return rowsOf(result)[0] || (targetId ? getProfileById(pool, tenantId, targetId) : getProfile(pool, tenantId));
}

/**
 * Add a NEW profile to the tenant's household, from the whitelisted
 * fields only. The new profile is neither primary nor active —
 * creating one never disturbs the profile sessions currently run
 * under (switch with setActiveProfile). A tenant with no profiles
 * yet gets this one as its primary + active profile. Enforces the
 * household limit (PROFILES_PER_TENANT_LIMIT).
 * @returns {Promise<object>} the created profile row
 * @throws Error with .code 'invalid_age_band' | 'invalid_field' |
 *   'profile_limit_reached'
 */
export async function createProfile(db, tenantId, fields = {}) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('createProfile: db (pg pool/client) required');
  if (!tenantId) throw new Error('createProfile: tenantId required');
  const clean = cleanProfileFields(fields);
  const existing = await listProfiles(pool, tenantId);
  if (existing.length >= PROFILES_PER_TENANT_LIMIT) {
    throw codedError('profile_limit_reached', `an account holds at most ${PROFILES_PER_TENANT_LIMIT} profiles`);
  }
  const isFirst = existing.length === 0;
  const cols = Object.keys(clean);
  const allCols = ['tenant_id', 'profile_id', 'is_primary', 'is_active', ...cols];
  const profileId = randomUUID();
  const values = [tenantId, profileId, isFirst, isFirst, ...cols.map((c) => clean[c])];
  const placeholders = allCols.map((_, i) => `$${i + 1}`);
  const result = await pool.query(
    `INSERT INTO profiles (${allCols.join(', ')})
     VALUES (${placeholders.join(', ')})
     RETURNING ${PROFILE_COLUMNS}`,
    values,
  );
  return rowsOf(result)[0] || getProfileById(pool, tenantId, profileId);
}

/**
 * Move the tenant's ACTIVE pointer to one of its own profiles — the
 * selection every session path then runs under (resolveProfileSafety
 * reads the active profile). This is account state changed by the
 * account holder through the profile routes; no session or tool
 * request can move it. Naming a profile that is not this tenant's
 * (or does not exist) throws 'profile_not_found' and moves nothing.
 * @returns {Promise<object>} the now-active profile row
 * @throws Error with .code 'profile_not_found'
 */
export async function setActiveProfile(db, tenantId, profileId) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('setActiveProfile: db (pg pool/client) required');
  if (!tenantId) throw new Error('setActiveProfile: tenantId required');
  const target = await getProfileById(pool, tenantId, profileId);
  if (!target) throw codedError('profile_not_found', 'no profile with that id belongs to this tenant');
  if (target.is_active === true) return target;
  await pool.query(
    `UPDATE profiles SET is_active = (profile_id = $2), updated_at = now()
      WHERE tenant_id = $1`,
    [tenantId, profileId],
  );
  return getProfileById(pool, tenantId, profileId);
}

/**
 * Set (or replace) the ACCOUNT's parent PIN. The PIN is one per
 * account (tenant), never per profile: the hash is stored only as a
 * lib/safety.js scrypt hash on the PRIMARY profile's row (the
 * account's first profile), however many child profiles the household
 * holds. PIN policy: a string of 4–12 characters (it is a PIN a parent
 * types on a phone, not a password — the account password in
 * lib/accounts.js carries the real length floor).
 * @throws Error with .code 'invalid_pin'
 */
export async function setParentPin(db, tenantId, pin) {
  const pool = await resolveDb(db);
  if (!pool || typeof pool.query !== 'function') throw new Error('setParentPin: db (pg pool/client) required');
  if (!tenantId) throw new Error('setParentPin: tenantId required');
  if (typeof pin !== 'string' || pin.length < 4 || pin.length > 12) {
    throw codedError('invalid_pin', 'pin must be a string of 4-12 characters');
  }
  const primary = await getPrimaryProfile(pool, tenantId);
  if (primary?.profile_id) {
    await pool.query(
      `INSERT INTO profiles (tenant_id, profile_id, parent_pin_hash) VALUES ($1, $2, $3)
       ON CONFLICT (tenant_id, profile_id) DO UPDATE
         SET parent_pin_hash = EXCLUDED.parent_pin_hash, updated_at = now()`,
      [tenantId, primary.profile_id, hashPin(pin)],
    );
  } else {
    // No profile row at all yet: create the primary row carrying the
    // hash (the pre-bite-9 INSERT created the row the same way).
    await pool.query(
      `INSERT INTO profiles (tenant_id, profile_id, parent_pin_hash, is_primary, is_active)
       VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, randomUUID(), hashPin(pin), true, true],
    );
  }
  return true;
}

/**
 * Check a PIN against the account's stored parent PIN (the primary
 * profile's hash — see setParentPin).
 * @returns {Promise<boolean>} false when no PIN is set, the tenant has
 *   no profile, or the PIN is wrong.
 */
export async function verifyParentPin(db, tenantId, pin) {
  const primary = await getPrimaryProfile(db, tenantId);
  if (!primary?.parent_pin_hash) return false;
  return verifyPin(pin, primary.parent_pin_hash);
}

/**
 * The safety decision for one tenant profile — THE helper the paid
 * handlers call in hosted mode, so what the tests pin here is the
 * production behavior, not a test-only copy. A null profile yields the
 * neutral decision (no fail-closed, no kid core): profiles are created
 * empty at signup, and a tenant who never finished onboarding gets the
 * standard posture until they pick an age band / safety mode.
 * @param {object|null} profile  a profiles row (or null)
 * @returns {{ failClosed: boolean, kidCore: boolean }}
 */
export function profileSafety(profile) {
  if (!profile) return safetyDecision({});
  return safetyDecision({
    safetyMode: profile.safety_mode === true,
    ageBand: profile.age_band ?? null,
  });
}

/**
 * The shared profile-safety resolver — safety-wiring bite 1
 * (safety-gap-map §7). Every profile-aware hosted handler (chat,
 * speak, image, video) takes its safety decision from HERE, so the
 * failure posture is defined in exactly one place:
 *
 *   - Profile row WITH an age band → the profile decides
 *     (profileSafety), exactly as before this bite. Request-supplied
 *     safety fields play no part: the resolver never even receives
 *     them, so a request can never weaken the profile's decision.
 *   - No profile row, a row whose age_band is still null (signup
 *     creates the row empty; onboarding has not finished), or a
 *     profile load that THROWS → the SAFE DEFAULT decides instead:
 *     safety applies ({ failClosed: true, kidCore: true }), with
 *     prompt inputs to match. A hosted tenant whose safety authority
 *     is missing or unreadable is treated as a child until their
 *     profile says otherwise — never as an adult, and never by
 *     falling back to whatever the request claimed. (Before this
 *     bite, each handler caught the load error itself and quietly
 *     used the request inputs; the shipped clients send none, so a
 *     profile-store failure silently downgraded a kid's session to
 *     the neutral posture.)
 *
 * HOSTED MODE ONLY: handlers call this solely when tenant
 * enforcement is on and a tenant resolved. Compat mode never calls
 * it and makes no profile query at all — request inputs decide
 * there, byte-for-byte as before the accounts bite.
 *
 * Never throws. `db` follows the getProfile contract: a pg
 * Pool/client or an async factory returning one (handlers pass
 * getProfileDb itself).
 *
 * Bite 9: the profile resolved is the tenant's ACTIVE profile (see
 * the file header). The optional `profileId` names one specific
 * profile of THIS tenant instead — used by the profile routes and
 * tests, never populated from a session/tool request body. A named
 * profile that does not belong to the tenant resolves exactly like
 * having no profile at all (the safe default): it never falls back
 * to the active profile or any sibling, so a wrong or foreign id
 * can only ever make the session MORE protected, never less.
 *
 * @param {object|Function} db
 * @param {string} tenantId
 * @param {string} [profileId] resolve this profile of the tenant
 *   instead of the active one
 * @returns {Promise<{
 *   decision: { failClosed: boolean, kidCore: boolean },
 *   inputs: { safetyMode: boolean, ageBand: string|null },
 *   safeDefault: boolean,
 *   source: 'profile'|'no-profile'|'incomplete-profile'|'load-error',
 *   profile: object|null,
 * }>} `decision` is what moderation consumes; `inputs` are the
 *   prompt-shaped fields (chat's buildSystemPrompt). safeDefault is
 *   true whenever source is not 'profile'.
 */
export async function resolveProfileSafety(db, tenantId, profileId = null) {
  const safeDefault = (source, profile = null) => ({
    decision: safetyDecision({ safetyMode: true }),
    inputs: { safetyMode: true, ageBand: null },
    safeDefault: true,
    source,
    profile,
  });
  let profile;
  try {
    profile = profileId
      ? await getProfileById(db, tenantId, profileId)
      : await getProfile(db, tenantId);
  } catch {
    return safeDefault('load-error');
  }
  if (!profile) return safeDefault('no-profile');
  const ageBand = typeof profile.age_band === 'string' && profile.age_band.trim()
    ? profile.age_band
    : null;
  if (ageBand === null) return safeDefault('incomplete-profile', profile);
  return {
    decision: profileSafety(profile),
    inputs: { safetyMode: profile.safety_mode === true, ageBand },
    safeDefault: false,
    source: 'profile',
    profile,
  };
}

let _pool = null;

/**
 * Lazily build the shared pg pool for profile reads/writes. Profiles
 * live in the same database as everything else (001's header), so this
 * delegates to lib/usage.js's pool factory. Handlers pass this function
 * itself into getProfile (the factory form), so the pool is only built
 * when a profile is actually read — never in compat mode, never in
 * tests.
 */
export async function getProfileDb() {
  if (_pool) return _pool;
  _pool = await getUsageDb();
  return _pool;
}
