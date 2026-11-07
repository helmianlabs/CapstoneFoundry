import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

const targetTenantId = '02070cfa-1e7c-4dc1-9bd9-31d9f9d5caf6';

try {
  await pool.query("BEGIN;");

  // Ensure tenant exists in tenants table
  await pool.query(`
    INSERT INTO tenants (id, status)
    VALUES ($1, 'active')
    ON CONFLICT (id) DO NOTHING;
  `, [targetTenantId]);
  console.log(`Tenant ${targetTenantId} ensured in tenants table.`);

  // Update memory_items from legacy tenant to Troy's active PWA tenant
  const updateRes = await pool.query(`
    UPDATE memory_items
    SET tenant_id = $1
    WHERE tenant_id = '00000000-0000-4000-8000-000000000001'
       OR tenant_id IS NULL;
  `, [targetTenantId]);
  console.log(`Updated ${updateRes.rowCount} memories to tenant ${targetTenantId}!`);

  await pool.query("COMMIT;");

  // Verify
  const verify = await pool.query(`
    SELECT count(*)::int as count
    FROM memory_items
    WHERE tenant_id = $1;
  `, [targetTenantId]);
  console.log(`Verified: ${verify.rows[0].count} memories now belong to tenant ${targetTenantId}!`);
} catch (e) {
  await pool.query("ROLLBACK;");
  console.error("Migration error:", e);
} finally {
  await pool.end();
}
