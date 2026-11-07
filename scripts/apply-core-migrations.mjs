import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

const sql1 = fs.readFileSync('E:/CapstoneFoundry/sql/store/001_tenants.sql', 'utf8');
const sql2 = fs.readFileSync('E:/CapstoneFoundry/sql/store/002_tenant_columns.sql', 'utf8');

console.log("Applying 001_tenants.sql...");
await pool.query(sql1);
console.log("001_tenants.sql applied successfully!");

console.log("Applying 002_tenant_columns.sql...");
await pool.query(sql2);
console.log("002_tenant_columns.sql applied successfully!");

// Verify memory_items has tenant_id and count of backfilled rows
const res = await pool.query(`
  SELECT count(*)::int as total,
         count(tenant_id)::int as with_tenant_id,
         count(*) FILTER (WHERE tenant_id = '00000000-0000-4000-8000-000000000001')::int as legacy_tenant_count
  FROM memory_items;
`);
console.log("Migration stats:", res.rows[0]);

await pool.end();
