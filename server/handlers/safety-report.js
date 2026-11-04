// server/handlers/safety-report.js — the receiving door for
// in-app reports of AI-generated content (store-readiness gap 2;
// lib: lib/reports.js; table: sql/store/009_content_reports.sql).
// Routes (the router dispatches on the first path segment, so this
// handler owns /api/safety-report):
//   POST /api/safety-report -> file one report
//
// Auth + tenancy: the tenant comes from the session token
// (lib/tenant.js requireTenant), NEVER from a body field — a body
// claiming another tenant_id is stripped by lib/reports.js's
// whitelist before anything is stored. Compat mode (no
// SESSION_SECRET) accepts under the legacy identity exactly as
// requireTenant resolves it, the same posture as the requests box.
//
// NO ORACLE: a signed-in POST always answers 200 { ok: true } —
// whether the report was stored or its body failed validation and
// nothing was stored (the failure is logged server-side only). The
// reporter's client can therefore never probe which bodies "work";
// it shows the same thanks either way, exactly as the settled
// design recorded. A report is a flag for human review; nothing
// here acts on one.

import { createReport, getReportsDb } from '../../lib/reports.js';
import { requireTenant } from '../../lib/tenant.js';

/**
 * The route logic, with the db injected — the default export
 * resolves the real pool; tests call this with a fake db.
 * @param {import('pg').Pool | Function} db
 */
export async function handleSafetyReport(req, res, db) {
  const tenant = requireTenant(req, res);
  if (!tenant) return; // requireTenant wrote the 401

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  try {
    await createReport(db, tenant.tenantId, req.body || {});
  } catch (e) {
    if (typeof e?.code === 'string' && e.code.startsWith('invalid_')) {
      // No oracle: the refusal is server-side knowledge only.
      console.error('[safety-report] refused body:', e.code);
      return res.status(200).json({ ok: true });
    }
    console.error('[safety-report] failed:', e?.message || e);
    return res.status(500).json({ error: 'internal' });
  }
  return res.status(200).json({ ok: true });
}

export default async function handler(req, res) {
  return handleSafetyReport(req, res, getReportsDb);
}
