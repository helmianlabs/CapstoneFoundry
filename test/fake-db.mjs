// test/fake-db.mjs — shared in-memory fake pg db for the accounts /
// profile tests. Implements just the query shapes lib/accounts.js,
// lib/profile.js, and lib/usage.js (getEntitlement) issue against the
// tenants / profiles / entitlements tables. Not a test file (no
// .test.mjs suffix), so the suite glob never runs it directly.
//
// The deletion bite adds: SELECT tenants by id, DELETE FROM <table>
// WHERE tenant_id = $1 for every tenant-scoped table (rows for the
// generic tables live in this.rows, a name -> [{tenant_id, ...}] map
// tests seed directly), and DELETE FROM tenants WHERE id = $1.
//
// Safety bite 9: profiles are PLURAL per tenant. The real store is
// this.profileRows (an array of row objects, each carrying
// profile_id / is_primary / is_active). this.profiles stays as the
// legacy per-tenant view — a Map from tenant_id to that tenant's
// PRIMARY row (the same object), kept in sync by the query branches —
// because the accounts/deletion tests assert against it directly.

export const GENERIC_TENANT_TABLES = [
  'usage_ledger', 'user_keys', 'relay_devices', 'relay_pairing_codes',
  'tenant_credit_grants', 'memory_items', 'conversation_sessions',
  'conversation_turns', 'actionable_projects', 'actionable_settings',
  'actionable_google_accounts', 'actionable_connections',
  'actionable_entries', 'actionable_items',
];

export class FakeDb {
  constructor() {
    this.tenants = [];
    this.profiles = new Map();
    this.profileRows = [];
    this.profileSeq = 0;
    this.entitlements = new Map();
    this.rows = {};
    for (const t of GENERIC_TENANT_TABLES) this.rows[t] = [];
    // Requests (sql/store/006): rows live in this.rows.requests, so
    // the generic tenant DELETE below reaches them too.
    this.rows.requests = [];
    this.requestSeq = 0;
    // Table names whose DELETE should fail with pg 42P01 (undefined
    // table) — tests use this to prove optional-table tolerance.
    this.missingTables = new Set();
  }

  _tenantProfileRows(tenantId) {
    return this.profileRows.filter((r) => r.tenant_id === tenantId);
  }

  _primaryProfileRow(tenantId) {
    const rows = this._tenantProfileRows(tenantId);
    return rows.find((r) => r.is_primary === true) || rows[0] || null;
  }

  _syncProfileMap(tenantId) {
    const primary = this._primaryProfileRow(tenantId);
    if (primary) this.profiles.set(tenantId, primary);
    else this.profiles.delete(tenantId);
  }

  async query(sql, params = []) {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (/^INSERT INTO tenants/i.test(s)) {
      const [id, email, passwordHash, provider] = params;
      if (this.tenants.some((t) => t.email && email && t.email.toLowerCase() === email.toLowerCase())) {
        const e = new Error('duplicate key value violates unique constraint "idx_tenants_email_unique"');
        e.code = '23505';
        throw e;
      }
      this.tenants.push({ id, email, password_hash: passwordHash, auth_provider: provider, status: 'active' });
      return { rows: [] };
    }
    if (/^SELECT .* FROM tenants WHERE email/i.test(s)) {
      const row = this.tenants.find((t) => t.email === params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (/^SELECT .* FROM tenants WHERE id/i.test(s)) {
      const row = this.tenants.find((t) => t.id === params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (/^DELETE FROM tenants WHERE id/i.test(s)) {
      const before = this.tenants.length;
      this.tenants = this.tenants.filter((t) => t.id !== params[0]);
      return { rows: [], rowCount: before - this.tenants.length };
    }
    const del = s.match(/^DELETE FROM (\w+) WHERE tenant_id = \$1/i);
    if (del) {
      const table = del[1].toLowerCase();
      if (this.missingTables.has(table)) {
        const e = new Error(`relation "${table}" does not exist`);
        e.code = '42P01';
        throw e;
      }
      if (table === 'profiles') {
        const before = this.profileRows.length;
        this.profileRows = this.profileRows.filter((r) => r.tenant_id !== params[0]);
        this.profiles.delete(params[0]);
        return { rows: [], rowCount: before - this.profileRows.length };
      }
      if (table === 'entitlements') {
        const had = this.entitlements.delete(params[0]);
        return { rows: [], rowCount: had ? 1 : 0 };
      }
      if (Object.prototype.hasOwnProperty.call(this.rows, table)) {
        const before = this.rows[table].length;
        this.rows[table] = this.rows[table].filter((r) => r.tenant_id !== params[0]);
        return { rows: [], rowCount: before - this.rows[table].length };
      }
      throw new Error(`FakeDb: unknown table in DELETE: ${table}`);
    }
    if (/^INSERT INTO profiles/i.test(s)) {
      const m = s.match(/INSERT INTO profiles \(([^)]+)\)/i);
      const cols = m[1].split(',').map((x) => x.trim());
      const given = {};
      cols.forEach((c, i) => { given[c] = params[i]; });
      const tenantId = given.tenant_id;
      let row = null;
      if (given.profile_id != null) {
        row = this.profileRows.find(
          (r) => r.tenant_id === tenantId && r.profile_id === given.profile_id,
        ) || null;
      }
      if (!row && /ON CONFLICT/i.test(s) && !/DO NOTHING/i.test(s)) {
        // Legacy insert shapes without a profile_id merge into the
        // tenant's primary row (the pre-bite-9 single-row behavior).
        row = this._primaryProfileRow(tenantId);
      }
      if (!row) {
        row = {
          tenant_id: tenantId, profile_id: given.profile_id ?? `fake-profile-${++this.profileSeq}`,
          display_name: null, age_band: null, about_me: null,
          safety_mode: false, parent_pin_hash: null,
          is_primary: false, is_active: false,
          created_at: new Date(), updated_at: new Date(),
        };
        this.profileRows.push(row);
        cols.forEach((c) => { row[c] = given[c]; });
      } else if (!/DO NOTHING/i.test(s)) {
        // ON CONFLICT DO UPDATE: apply only the SET clause's columns
        // (the real statement never rewrites identity/flag columns
        // on conflict), mirroring pg.
        const setM = s.match(/DO UPDATE SET (.+?)(?:, updated_at| RETURNING|$)/i);
        const setCols = setM
          ? setM[1].split(',').map((x) => x.split('=')[0].trim())
          : cols.filter((c) => c !== 'tenant_id' && c !== 'profile_id');
        setCols.forEach((c) => { if (given[c] !== undefined) row[c] = given[c]; });
        row.updated_at = new Date();
      }
      this._syncProfileMap(tenantId);
      return { rows: [{ ...row }] };
    }
    if (/^SELECT .* FROM profiles WHERE tenant_id/i.test(s)) {
      let rows = this._tenantProfileRows(params[0]).map((r) => ({ ...r }));
      const pidM = s.match(/profile_id = \$(\d+)/i);
      if (pidM) rows = rows.filter((r) => r.profile_id === params[Number(pidM[1]) - 1]);
      if (/is_primary = true/i.test(s)) rows = rows.filter((r) => r.is_primary === true);
      const obM = s.match(/ORDER BY (.+?) LIMIT/i) || s.match(/ORDER BY (.+)$/i);
      if (obM) {
        const terms = obM[1].split(',').map((x) => x.trim());
        rows.sort((a, b) => {
          for (const t of terms) {
            let cmp = 0;
            if (/is_active/i.test(t)) cmp = (a.is_active === true ? 1 : 0) - (b.is_active === true ? 1 : 0);
            else if (/is_primary/i.test(t)) cmp = (a.is_primary === true ? 1 : 0) - (b.is_primary === true ? 1 : 0);
            else if (/created_at/i.test(t)) cmp = new Date(a.created_at) - new Date(b.created_at);
            else if (/profile_id/i.test(t)) cmp = String(a.profile_id).localeCompare(String(b.profile_id));
            if (cmp !== 0) return /DESC/i.test(t) ? -cmp : cmp;
          }
          return 0;
        });
      }
      const limM = s.match(/LIMIT (\d+)/i);
      if (limM) rows = rows.slice(0, Number(limM[1]));
      return { rows };
    }
    if (/^UPDATE profiles SET is_active/i.test(s)) {
      const [tenantId, profileId] = params;
      let changed = 0;
      for (const r of this._tenantProfileRows(tenantId)) {
        const next = r.profile_id === profileId;
        if (r.is_active !== next) changed += 1;
        r.is_active = next;
        r.updated_at = new Date();
      }
      this._syncProfileMap(tenantId);
      return { rows: [], rowCount: changed };
    }
    if (/^INSERT INTO entitlements/i.test(s)) {
      if (!this.entitlements.has(params[0])) {
        this.entitlements.set(params[0], {
          tenant_id: params[0], plan: 'free', status: 'active',
          current_period_end: null, revenuecat_app_user_id: null,
        });
      }
      return { rows: [] };
    }
    if (/^SELECT .* FROM entitlements WHERE tenant_id/i.test(s)) {
      const row = this.entitlements.get(params[0]);
      return { rows: row ? [{ ...row }] : [] };
    }
    if (/^INSERT INTO requests/i.test(s)) {
      const [tenantId, kind, payloadJson] = params;
      this.requestSeq += 1;
      const row = {
        id: `00000000-0000-4000-8000-${String(this.requestSeq).padStart(12, '0')}`,
        tenant_id: tenantId,
        kind,
        payload: typeof payloadJson === 'string' ? JSON.parse(payloadJson) : payloadJson,
        status: 'new',
        // Stagger timestamps so ORDER BY created_at DESC is testable.
        created_at: new Date(Date.now() + this.requestSeq * 1000),
      };
      this.rows.requests.push(row);
      return { rows: [{ ...row, payload: { ...row.payload } }] };
    }
    if (/^SELECT .* FROM requests WHERE tenant_id/i.test(s)) {
      const mine = this.rows.requests
        .filter((r) => r.tenant_id === params[0])
        .sort((a, b) => b.created_at - a.created_at);
      return { rows: mine.map((r) => ({ ...r, payload: { ...r.payload } })) };
    }
    if (/^SELECT .* FROM requests WHERE id/i.test(s)) {
      const row = this.rows.requests.find((r) => r.id === params[0]);
      return { rows: row ? [{ ...row, payload: { ...row.payload } }] : [] };
    }
    if (/^UPDATE requests SET status/i.test(s)) {
      const row = this.rows.requests.find((r) => r.id === params[1]);
      if (!row) return { rows: [] };
      row.status = params[0];
      return { rows: [{ ...row, payload: { ...row.payload } }] };
    }
    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 140)}`);
  }
}
