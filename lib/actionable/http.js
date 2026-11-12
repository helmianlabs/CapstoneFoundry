// lib/actionable/http.js
// ---------------------------------------------------------------------------
// Shared CORS + auth guard for the Actionable routes.
//
// 🔴 SECURITY NOTE, STATED PLAINLY: the existing routes in this app (api/memory.js:585-611,
// api/diary.js:7-12) identify the caller by a `userId` STRING IN THE REQUEST and
// perform no authentication. Anyone who guesses a userId can read that user's
// data. For a memory store of chat facts that was a small risk; for a brain-dump
// journal containing business strategy, money, and personal life it is not.
//
// So these routes support a shared secret. It is enforced WHEN SET, which means:
//   - Set ACTIONABLE_API_KEY → every request must present it. Recommended, and
//     the setup guide says so.
//   - Leave it unset → routes stay open, matching how the rest of this app
//     already behaves, and NOTHING that exists today breaks.
//
// This is a deliberate trade: fail-open preserves the "add alongside, break
// nothing" constraint, and the guide's step 6 turns it on. It is not a claim
// that the endpoints are secure by default — they are not until that value is set.
//
// UPDATE Nov 12, 2026: that gap is closed. requireAuth now ALSO requires the
// same identity proof as the memory routes (session Bearer token, or
// X-Webhook-Secret + tenant id) whenever SESSION_SECRET is set (production).
// ---------------------------------------------------------------------------

import { timingSafeEqual } from 'node:crypto';
import { authorizeMemoryAccess } from '../tenant.js';

export function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ACTIONABLE_ALLOW_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Actionable-Key, Authorization, X-Webhook-Secret');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

export function requireAuth(req, res) {
  const expected = process.env.ACTIONABLE_API_KEY;
  if (expected) {
    const got = req.headers['x-actionable-key'];
    const a = Buffer.from(String(got || ''));
    const b = Buffer.from(expected);
    // timingSafeEqual throws when lengths differ, so compare length first.
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Unauthorized — missing or wrong X-Actionable-Key header' });
      return false;
    }
  }

  // Identity (Nov 12, 2026): a userId in the request is NOT a credential.
  // Same rule as the memory routes (lib/tenant.js authorizeMemoryAccess):
  // a signed-in session (Authorization: Bearer) decides the user, or a
  // server-to-server caller proves itself with X-Webhook-Secret and then
  // names a tenant id. With SESSION_SECRET unset (local/dev compat mode)
  // legacy ids pass exactly as before. The authorized id is written back
  // over userId so every handler below reads only the authorized identity.
  const candidate = readQuery(req, 'userId') ?? req.body?.userId ?? '';
  const access = authorizeMemoryAccess(req, String(candidate));
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return false;
  }
  req.actionableUserId = access.userId;
  if (req.query && typeof req.query === 'object') req.query.userId = access.userId;
  if (req.body && typeof req.body === 'object') req.body.userId = access.userId;
  return true;
}

export function readQuery(req, key, fallback = null) {
  const v = req.query?.[key];
  if (Array.isArray(v)) return v[0] ?? fallback;
  return (v === undefined || v === '') ? fallback : v;
}
