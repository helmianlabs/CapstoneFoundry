import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const r1 = await pool.query("SELECT count(*)::int as count FROM memory_items WHERE user_id = 'troy';");
  console.log("Query by user_id = 'troy':", r1.rows[0].count);

  try {
    const r2 = await pool.query("SELECT count(*)::int as count FROM memory_items WHERE tenant_id = '00000000-0000-4000-8000-000000000001';");
    console.log("Query by tenant_id:", r2.rows[0].count);
  } catch (err2) {
    console.log("Query by tenant_id failed:", err2.message);
  }
} finally {
  await pool.end();
}
