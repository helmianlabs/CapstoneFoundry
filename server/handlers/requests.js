// api/requests.js — the unified request box (requests bite B1;
// design: curriculum-requests-spec.md §1–§2). Routes (the router
// dispatches on the first path segment, so this handler owns
// /api/requests):
//   POST /api/requests -> file a request of either kind
//   GET  /api/requests -> the caller's own requests + status labels
//
// Auth + tenancy: the tenant comes from the session token
// (lib/tenant.js requireTenant), NEVER from a body field — a body
// claiming another tenant_id is stripped by lib/requests.js's
// whitelist before anything is stored. Per the spec (§1.1, and §5
// before it), compat mode (no SESSION_SECRET) accepts under the
// legacy identity exactly as requireTenant resolves it — unlike the
// accounts-only profile surface, which 503s in compat mode, this box
// predates accounts in spirit: it is the single user's suggestion
// box in the live deployment and every tenant's box in hosted mode.
//
// Statuses are OPERATOR-side only. This handler exposes no verb that
// can move one: POST always lands at 'new', there is no PUT/PATCH
// route, and lib/requests.js's setRequestStatus refuses every actor
// except the operator. Troy works the desk (spec §6 bite B4); the
// requester's only power here is to ask and to watch.
//
// Serialization is an explicit whitelist, and the payload is rebuilt
// from the stored row through the kind's field list — so even a row
// written by something other than createRequest cannot leak extra
// keys to the requester.

import {
  createRequest, listRequests, getRequestsDb,
  STATUS_LABELS, PROVIDER_FIELDS, CURRICULUM_FIELDS,
} from '../../lib/requests.js';
import { requireTenant } from '../../lib/tenant.js';

/** Whitelisted public shape of a request row. */
export function publicRequest(row) {
  const fields = row?.kind === 'curriculum' ? CURRICULUM_FIELDS : PROVIDER_FIELDS;
  const stored = row?.payload && typeof row.payload === 'object' ? row.payload : {};
  const payload = {};
  for (const f of fields) {
    if (stored[f] !== undefined) payload[f] = stored[f];
  }
  return {
    id: row?.id ?? null,
    kind: row?.kind ?? null,
    payload,
    status: row?.status ?? null,
    status_label: STATUS_LABELS[row?.status] ?? null,
    created_at: row?.created_at ?? null,
  };
}

/**
 * The route logic, with the db injected — the default export
 * resolves the real pool; tests call this with a fake db.
 * @param {import('pg').Pool | Function} db
 */
export async function handleRequests(req, res, db) {
  const tenant = requireTenant(req, res);
  if (!tenant) return; // requireTenant wrote the 401
  const tenantId = tenant.tenantId;

  try {
    if (req.method === 'POST') {
      let created;
      try {
        created = await createRequest(db, tenantId, req.body || {});
      } catch (e) {
        if (typeof e?.code === 'string' && e.code.startsWith('invalid_')) {
          return res.status(400).json({ error: e.code });
        }
        throw e;
      }
      return res.status(201).json({ ok: true, request: publicRequest(created) });
    }

    if (req.method === 'GET') {
      const rows = await listRequests(db, tenantId);
      return res.status(200).json({ requests: rows.map(publicRequest) });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    console.error('[requests] failed:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
}

export default async function handler(req, res) {
  return handleRequests(req, res, getRequestsDb);
}
