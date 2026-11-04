// api/profile.js — the tenant's own profiles for the hosted
// ThinkinBuddy (accounts bite). Routes (router dispatches on the
// first path segment, so this handler owns /api/profile/*):
//   GET  /api/profile            -> active profile + entitlement plan
//   PUT  /api/profile            -> update whitelisted fields on the
//                                   active profile, or on the profile
//                                   named by body.profile_id
//   GET  /api/profile/profiles   -> every profile in the household
//   POST /api/profile/profiles   -> create a new profile
//   POST /api/profile/active     { profile_id } -> choose which
//                                   profile sessions run under
//   POST /api/profile/pin        { pin } -> set/replace the parent PIN
//   POST /api/profile/pin/verify { pin } -> { ok: boolean }
//
// Auth: a valid session token (lib/tenant.js requireTenant) — a
// profile belongs to exactly the tenant in the token, never to an id
// in the request. Profiles are a hosted-mode concept: in compat mode
// (no SESSION_SECRET) this answers 503 { error: 'accounts_not_configured' },
// same as /api/auth.
//
// PLURAL PROFILES (safety bite 9, sql/store/007): one account holds a
// household of profiles, each with its own age band and safety mode.
// Sessions resolve safety from the tenant's ACTIVE profile — a
// server-side pointer moved only by the /active route below, never
// by a field on a session or tool request. body.profile_id on PUT is
// a WRITE-TARGET selector among the tenant's OWN profiles (the
// account holder editing their household); it is validated against
// the tenant and a foreign id is a 404, never a silent retarget.
//
// TROY'S PIN RULE — both halves live HERE, before the write, and as
// of bite 9 they are evaluated against the ACCOUNT's lock, not the
// targeted row: the PIN hash lives on the primary profile's row, so
// a child profile's own (always null) hash must never read as "no
// PIN protects this account."
//   OFF (the original half): turning safety_mode OFF on a profile
//   whose safety is on requires the parent PIN when one is set — a
//   kid holding the phone must not be able to flip safety off. PUT
//   with safety_mode:false while the account PIN is set needs { pin }
//   in the same request, verified against the stored hash. When NO
//   pin is set yet, turning safety off is allowed (there is nothing
//   to bypass — the parent has not armed the lock) but the response
//   says so plainly: { pinSet: false, warning: 'no_parent_pin_set' }.
//   ON (safety bite 8): "safety mode is on" and "a parent PIN
//   protects it" are the same state. A write that turns safety_mode
//   ON (PUT, or creating a profile with safety on) while NO PIN hash
//   exists needs { pin } in the same request; the hash is set as part
//   of this operation (setParentPin) so no client — shipped or
//   hand-rolled — can arm safety without arming the lock. Without a
//   pin the write is refused 403 { error: 'parent_pin_required' }
//   (the same named error the OFF half uses when its PIN is absent)
//   and NOTHING is written. A PIN already on file satisfies the rule
//   by itself; a pin sent alongside is then ignored — replacing a
//   PIN stays the /pin route's job.
//   SWITCH (bite 9): moving the active pointer from a protected
//   profile (its decision fails closed — safety on or a minor band)
//   to an unprotected one disarms the session exactly like turning
//   safety off, so it takes the same PIN when one is set; with no
//   PIN set it is allowed and the response carries the same warning.
//
// Serialization is an explicit whitelist: parent_pin_hash and any
// other credential material NEVER leave the server. The response
// carries pin_set (a boolean — the ACCOUNT's lock state, whichever
// profile is being serialized) so the client can show "PIN is set"
// without ever seeing the hash.

import {
  getProfile, getProfileById, listProfiles, createProfile,
  upsertProfile, setActiveProfile, setParentPin, verifyParentPin,
  hasParentPin, profileSafety, getProfileDb, PROFILE_FIELDS,
} from '../../lib/profile.js';
import { getEntitlement } from '../../lib/usage.js';
import { requireTenant, tenantEnforced } from '../../lib/tenant.js';

function routeOf(req) {
  let pathname = '';
  try {
    pathname = new URL(req.url, 'http://local').pathname;
  } catch {
    pathname = String(req.url || '');
  }
  if (/\/pin\/verify\/?$/.test(pathname)) return 'pin-verify';
  if (/\/pin\/?$/.test(pathname)) return 'pin';
  if (/\/profiles\/?$/.test(pathname)) return 'profiles';
  if (/\/active\/?$/.test(pathname)) return 'active';
  return 'root';
}

/**
 * Whitelisted public shape of a profile row. No hash material, ever.
 * pin_set is the ACCOUNT's lock state (see the header): pass the
 * hasParentPin result when the caller has it; the default reads the
 * row's own hash, which is the same thing for the primary profile.
 */
export function publicProfile(profile, pinSet = undefined) {
  return {
    profile_id: profile?.profile_id ?? null,
    display_name: profile?.display_name ?? null,
    age_band: profile?.age_band ?? null,
    about_me: profile?.about_me ?? null,
    safety_mode: profile?.safety_mode === true,
    is_primary: profile?.is_primary === true,
    is_active: profile?.is_active === true,
    pin_set: pinSet ?? Boolean(profile?.parent_pin_hash),
  };
}

/**
 * The route logic, with the db injected — the default export resolves
 * the real pool; tests call this with a fake db.
 * @param {import('pg').Pool | Function} db
 */
export async function handleProfile(req, res, db) {
  if (!tenantEnforced()) return res.status(503).json({ error: 'accounts_not_configured' });
  const tenant = requireTenant(req, res);
  if (!tenant) return; // requireTenant wrote the 401
  const tenantId = tenant.tenantId;
  const route = routeOf(req);
  const body = req.body || {};

  /**
   * Troy's PIN rule for a safety write (see the header), shared by
   * PUT and by profile creation. `currentSafety` is the targeted
   * profile's safety_mode BEFORE the write (false for a profile
   * being created). Returns { warning } when the write may proceed,
   * or { refuse: [status, body] } when it may not — in which case
   * NOTHING has been written, including a PIN the request carried.
   */
  async function checkSafetyWrite(currentSafety, fields) {
    if (fields.safety_mode === false && currentSafety === true) {
      if (await hasParentPin(db, tenantId)) {
        if (typeof body.pin !== 'string' || !body.pin) {
          return { refuse: [403, { error: 'parent_pin_required' }] };
        }
        if (!(await verifyParentPin(db, tenantId, body.pin))) {
          return { refuse: [403, { error: 'invalid_parent_pin' }] };
        }
        return { warning: null };
      }
      return { warning: 'no_parent_pin_set' };
    }
    // Bite 8 — the ON half: safety ON with no PIN on file requires
    // { pin } in this same request. The hash is set BEFORE the
    // profile write, so an invalid PIN refuses with zero profile
    // fields written, and the row the write returns already sits
    // under an armed lock (the response's pin_set is true).
    if (fields.safety_mode === true) {
      if (!(await hasParentPin(db, tenantId))) {
        if (typeof body.pin !== 'string' || !body.pin) {
          return { refuse: [403, { error: 'parent_pin_required' }] };
        }
        try {
          await setParentPin(db, tenantId, body.pin);
        } catch (e) {
          if (e?.code === 'invalid_pin') return { refuse: [400, { error: 'invalid_pin' }] };
          throw e;
        }
      }
    }
    return { warning: null };
  }

  try {
    if (route === 'pin') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      try {
        await setParentPin(db, tenantId, body.pin);
      } catch (e) {
        if (e?.code === 'invalid_pin') return res.status(400).json({ error: 'invalid_pin' });
        throw e;
      }
      return res.status(200).json({ ok: true, pinSet: true });
    }

    if (route === 'pin-verify') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      const ok = await verifyParentPin(db, tenantId, body.pin);
      return res.status(200).json({ ok });
    }

    if (route === 'profiles') {
      if (req.method === 'GET') {
        const [profiles, pinSet] = await Promise.all([
          listProfiles(db, tenantId),
          hasParentPin(db, tenantId),
        ]);
        return res.status(200).json({
          tenantId,
          profiles: profiles.map((p) => publicProfile(p, pinSet)),
        });
      }
      if (req.method === 'POST') {
        const fields = {};
        for (const f of PROFILE_FIELDS) {
          if (body[f] !== undefined) fields[f] = body[f];
        }
        // A profile created with safety ON arms the account lock in
        // the same operation, exactly like a PUT that turns it on.
        const check = await checkSafetyWrite(false, fields);
        if (check.refuse) return res.status(check.refuse[0]).json(check.refuse[1]);
        let created;
        try {
          created = await createProfile(db, tenantId, fields);
        } catch (e) {
          if (e?.code === 'profile_limit_reached') return res.status(400).json({ error: 'profile_limit_reached' });
          if (e?.code === 'invalid_age_band') return res.status(400).json({ error: 'invalid_age_band' });
          if (e?.code === 'invalid_field') return res.status(400).json({ error: 'invalid_field' });
          throw e;
        }
        const pinSet = await hasParentPin(db, tenantId);
        return res.status(200).json({
          tenantId,
          ...publicProfile(created, pinSet),
          pinSet,
        });
      }
      return res.status(405).json({ error: 'method_not_allowed' });
    }

    if (route === 'active') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
      if (typeof body.profile_id !== 'string' || !body.profile_id) {
        return res.status(400).json({ error: 'profile_id_required' });
      }
      const target = await getProfileById(db, tenantId, body.profile_id);
      if (!target) return res.status(404).json({ error: 'profile_not_found' });
      // Switching away from a protected profile to an unprotected
      // one disarms the session like turning safety off does — same
      // PIN gate, same no-lock warning (see the header).
      let warning = null;
      const current = await getProfile(db, tenantId);
      if (
        current && current.profile_id !== target.profile_id
        && profileSafety(current).failClosed && !profileSafety(target).failClosed
      ) {
        if (await hasParentPin(db, tenantId)) {
          if (typeof body.pin !== 'string' || !body.pin) {
            return res.status(403).json({ error: 'parent_pin_required' });
          }
          if (!(await verifyParentPin(db, tenantId, body.pin))) {
            return res.status(403).json({ error: 'invalid_parent_pin' });
          }
        } else {
          warning = 'no_parent_pin_set';
        }
      }
      const active = await setActiveProfile(db, tenantId, body.profile_id);
      const pinSet = await hasParentPin(db, tenantId);
      const response = {
        tenantId,
        ...publicProfile(active, pinSet),
        pinSet,
      };
      if (warning) response.warning = warning;
      return res.status(200).json(response);
    }

    // root: GET / PUT — the ACTIVE profile, or the profile named by
    // body.profile_id on PUT.
    if (req.method === 'GET') {
      const [profile, entitlement, pinSet] = await Promise.all([
        getProfile(db, tenantId),
        getEntitlement(typeof db === 'function' ? await db() : db, tenantId).catch(() => null),
        hasParentPin(db, tenantId),
      ]);
      return res.status(200).json({
        tenantId,
        ...publicProfile(profile, pinSet),
        plan: entitlement?.plan ?? null,
        entitlement_status: entitlement?.status ?? null,
      });
    }

    if (req.method === 'PUT') {
      const fields = {};
      for (const f of PROFILE_FIELDS) {
        if (body[f] !== undefined) fields[f] = body[f];
      }
      const targetId = typeof body.profile_id === 'string' && body.profile_id
        ? body.profile_id
        : null;
      let current;
      if (targetId) {
        current = await getProfileById(db, tenantId, targetId);
        if (!current) return res.status(404).json({ error: 'profile_not_found' });
      } else {
        current = await getProfile(db, tenantId);
      }
      // Troy's PIN rule (see the header), evaluated against the
      // targeted profile's current safety and the ACCOUNT's lock.
      const check = await checkSafetyWrite(current?.safety_mode === true, fields);
      if (check.refuse) return res.status(check.refuse[0]).json(check.refuse[1]);
      let updated;
      try {
        updated = await upsertProfile(db, tenantId, fields, current?.profile_id ?? null);
      } catch (e) {
        if (e?.code === 'invalid_age_band') return res.status(400).json({ error: 'invalid_age_band' });
        if (e?.code === 'invalid_field') return res.status(400).json({ error: 'invalid_field' });
        if (e?.code === 'profile_not_found') return res.status(404).json({ error: 'profile_not_found' });
        throw e;
      }
      const pinSet = await hasParentPin(db, tenantId);
      const response = {
        tenantId,
        ...publicProfile(updated, pinSet),
        pinSet,
      };
      if (check.warning) response.warning = check.warning;
      return res.status(200).json(response);
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[profile] failed:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
}

export default async function handler(req, res) {
  return handleProfile(req, res, getProfileDb);
}
