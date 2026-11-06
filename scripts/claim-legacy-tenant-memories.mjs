// scripts/claim-legacy-tenant-memories.mjs
// ---------------------------------------------------------------------------
// Move stranded legacy-tenant memory and conversation rows onto one
// existing email account. See sql/store/012_claim_legacy_memories.sql
// and docs/store/CLAIM_LEGACY_MEMORIES.md. The two implementations must
// stay equivalent; test/claim-legacy-tenant-memories.test.mjs pins the
// safety predicates.
//
// Does not create or delete tenants. Does not delete rows. The destination
// email is an operator argument, never an application owner.
//
// DEFAULT IS DRY-RUN (counts only). Pass --apply to write, in one
// transaction. Re-running after a successful apply updates 0 rows.
//
// USAGE:
//   DATABASE_URL_MEMORY=... \
//     node scripts/claim-legacy-tenant-memories.mjs --email=person@example.com
//   DATABASE_URL_MEMORY=... \
//     node scripts/claim-legacy-tenant-memories.mjs --email=person@example.com --apply
//
// Optional signed-in prime check (does not print the prompt):
//   SESSION_SECRET=... \
//     node scripts/claim-legacy-tenant-memories.mjs --email=... --verify-prime
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { signSession } from '../lib/tenant.js';

export const LEGACY_TENANT_ID = '00000000-0000-4000-8000-000000000001';
export const LEGACY_USER_ID = 'troy';

// Statements shared with sql/store/012_claim_legacy_memories.sql.
// $1 = destination tenant id, $2 = legacy tenant id, $3 = legacy user id.
export const CLAIM_STATEMENTS = {
  moveMemories: `
    UPDATE memory_items
       SET tenant_id = $1
     WHERE tenant_id = $2
       AND user_id = $3`,
  moveTurns: `
    UPDATE conversation_turns t
       SET tenant_id = $1
      FROM conversation_sessions s
     WHERE t.session_id = s.id
       AND s.tenant_id = $2
       AND s.user_id = $3
       AND t.tenant_id IS DISTINCT FROM $1`,
  moveSessions: `
    UPDATE conversation_sessions
       SET tenant_id = $1,
           user_id = $1::text
     WHERE tenant_id = $2
       AND user_id = $3`,
  sweepTurns: `
    UPDATE conversation_turns t
       SET tenant_id = $1
      FROM conversation_sessions s
     WHERE t.session_id = s.id
       AND s.tenant_id = $1
       AND s.user_id IN ($1::text, $3)
       AND t.tenant_id = $2`,
  repairSessionUser: `
    UPDATE conversation_sessions
       SET user_id = $1::text
     WHERE tenant_id = $1
       AND user_id = $3`,
};

try {
  const envPath = new URL('../.env.memory.local', import.meta.url);
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const mm = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (!mm || process.env[mm[1]]) continue;
      let value = mm[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[mm[1]] = value;
    }
  }
} catch { /* optional file */ }

function argValue(args, name) {
  const prefix = `--${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return null;
}

function databaseLabel(conn) {
  try {
    const u = new URL(conn);
    return { host: u.hostname, database: u.pathname.replace(/^\//, '') };
  } catch {
    return { host: '(unparsed)', database: '(unparsed)' };
  }
}

async function resolveDestination(client, email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw Object.assign(new Error('refusing: --email must be an existing account address'), { code: 'refused' });
  }
  const { rows } = await client.query(
    `SELECT id, status FROM tenants WHERE lower(email) = $1`,
    [normalized],
  );
  if (rows.length !== 1) {
    throw Object.assign(
      new Error(`refusing: email matched ${rows.length} tenant row(s); need exactly 1`),
      { code: 'refused' },
    );
  }
  const dest = rows[0];
  if (dest.id === LEGACY_TENANT_ID) {
    throw Object.assign(new Error('refusing: resolved tenant is the legacy tenant'), { code: 'refused' });
  }
  if (dest.status !== 'active') {
    throw Object.assign(
      new Error(`refusing: destination status is ${dest.status} (need active)`),
      { code: 'refused' },
    );
  }
  return dest.id;
}

async function requireTenantColumn(client) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'memory_items' AND column_name = 'tenant_id'`,
  );
  if (!rows.length) {
    throw Object.assign(
      new Error('refusing: memory_items.tenant_id is missing (sql/store/002 not applied)'),
      { code: 'refused' },
    );
  }
}

async function collectCounts(client, dest) {
  const q = async (sql, params) => (await client.query(sql, params)).rows;
  const memoryByUser = await q(
    `SELECT user_id, count(*)::int AS n
       FROM memory_items
      WHERE tenant_id = $1
      GROUP BY user_id
      ORDER BY n DESC, user_id`,
    [LEGACY_TENANT_ID],
  );
  const memoryByScope = await q(
    `SELECT scope, count(*)::int AS n
       FROM memory_items
      WHERE tenant_id = $1 AND user_id = $2
      GROUP BY scope
      ORDER BY n DESC, scope`,
    [LEGACY_TENANT_ID, LEGACY_USER_ID],
  );
  const primeVisible = await q(
    `SELECT count(*)::int AS n
       FROM memory_items
      WHERE tenant_id = $1
        AND scope = 'semantic'
        AND (valid_until IS NULL OR valid_until > now())`,
    [dest],
  );
  const sessions = await q(
    `SELECT count(*)::int AS n
       FROM conversation_sessions
      WHERE tenant_id = $1 AND user_id = $2`,
    [LEGACY_TENANT_ID, LEGACY_USER_ID],
  );
  const turns = await q(
    `SELECT count(*)::int AS n
       FROM conversation_turns t
       JOIN conversation_sessions s ON s.id = t.session_id
      WHERE s.tenant_id = $1 AND s.user_id = $2`,
    [LEGACY_TENANT_ID, LEGACY_USER_ID],
  );
  const otherTurns = await q(
    `SELECT count(*)::int AS n
       FROM conversation_turns
      WHERE tenant_id = $1`,
    [LEGACY_TENANT_ID],
  );
  const destSessions = await q(
    `SELECT count(*)::int AS n
       FROM conversation_sessions
      WHERE tenant_id = $1 AND user_id = $1::text`,
    [dest],
  );
  const legacyTroyMemories = memoryByUser
    .filter((r) => r.user_id === LEGACY_USER_ID)
    .reduce((sum, r) => sum + r.n, 0);
  return {
    legacyTenantId: LEGACY_TENANT_ID,
    destinationTenantId: dest,
    legacyMemoryByUserId: memoryByUser,
    legacyTroyMemoryByScope: memoryByScope,
    legacyTroyMemoryCount: legacyTroyMemories,
    legacyOtherMemoryCount: memoryByUser
      .filter((r) => r.user_id !== LEGACY_USER_ID)
      .reduce((sum, r) => sum + r.n, 0),
    destinationPrimeVisible: primeVisible[0].n,
    legacyTroySessions: sessions[0].n,
    legacyTroySessionTurns: turns[0].n,
    legacyTenantTurns: otherTurns[0].n,
    destinationSessionsWithTenantUserId: destSessions[0].n,
  };
}

async function applyClaim(client, dest) {
  await client.query('BEGIN');
  try {
    let triggerSuppression = 'off';
    await client.query('SAVEPOINT trigger_suppress');
    try {
      await client.query(`SELECT set_config('session_replication_role', 'replica', true)`);
      triggerSuppression = 'replica';
      await client.query('RELEASE SAVEPOINT trigger_suppress');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT trigger_suppress');
      triggerSuppression = `unavailable: ${e?.code || 'error'}`;
    }
    await client.query(
      `SELECT id FROM memory_items WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
      [LEGACY_TENANT_ID, LEGACY_USER_ID],
    );
    await client.query(
      `SELECT id FROM conversation_sessions WHERE tenant_id = $1 AND user_id = $2 FOR UPDATE`,
      [LEGACY_TENANT_ID, LEGACY_USER_ID],
    );
    const params = [dest, LEGACY_TENANT_ID, LEGACY_USER_ID];
    const moved = {};
    for (const [name, sql] of Object.entries(CLAIM_STATEMENTS)) {
      const result = await client.query(sql, params);
      moved[name] = result.rowCount;
    }
    await client.query('COMMIT');
    return { triggerSuppression, moved };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
    throw e;
  }
}

export async function verifyPrime({ secret, tenantId, url }) {
  if (!secret) {
    throw Object.assign(new Error('refusing: SESSION_SECRET is required for --verify-prime'), { code: 'refused' });
  }
  const token = signSession(tenantId, secret, 120);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId: tenantId, buddyName: 'Mark' }),
  });
  const body = await res.json().catch(() => null);
  return {
    httpStatus: res.status,
    ok: body?.ok === true,
    memoryCount: typeof body?.memoryCount === 'number' ? body.memoryCount : null,
    tenantId: typeof body?.tenantId === 'string' ? body.tenantId : null,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const email = argValue(args, 'email') || process.env.TARGET_EMAIL || '';
  const apply = args.includes('--apply');
  const verify = args.includes('--verify-prime');
  const primeUrl = argValue(args, 'prime-url')
    || process.env.PRIME_URL
    || 'https://thinkbuddy-sandy.vercel.app/api/prime-agent';
  const connArg = args.find((a) => !a.startsWith('--'));
  const conn = connArg || process.env.DATABASE_URL_MEMORY || process.env.DATABASE_URL;
  if (!conn || conn.trim().length < 12) {
    console.error('✗ No connection string. Set DATABASE_URL_MEMORY (the memory database).');
    process.exit(1);
  }

  const label = databaseLabel(conn);
  console.log(`→ target database: ${label.database} on ${label.host}`);
  console.log(`→ mode: ${apply ? 'APPLY' : 'dry-run'}`);

  const { Pool } = await import('pg');
  const pool = new Pool({
    connectionString: conn,
    max: 1,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    await requireTenantColumn(client);
    const dest = await resolveDestination(client, email);
    const before = await collectCounts(client, dest);
    const report = {
      emailResolved: true,
      destinationTenantId: dest,
      legacyTenantId: LEGACY_TENANT_ID,
      before,
    };
    console.log(JSON.stringify(report, null, 2));

    if (!apply) {
      console.log('dry-run: no rows written. Pass --apply to move them.');
    } else {
      const applied = await applyClaim(client, dest);
      const after = await collectCounts(client, dest);
      console.log(JSON.stringify({ applied, after }, null, 2));
    }

    if (verify) {
      const prime = await verifyPrime({
        secret: process.env.SESSION_SECRET,
        tenantId: dest,
        url: primeUrl,
      });
      console.log(JSON.stringify({ prime }, null, 2));
      if (!(prime.ok && prime.memoryCount > 0 && prime.tenantId === dest)) {
        process.exitCode = 3;
      }
    }
  } catch (e) {
    console.error(`✗ ${e?.message || e}`);
    process.exitCode = e?.code === 'refused' ? 2 : 1;
  } finally {
    client.release();
    await pool.end();
  }
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main();
}
