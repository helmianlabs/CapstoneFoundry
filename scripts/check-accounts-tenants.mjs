import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const tbls = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public';");
  console.log("Tables in thinkinbuddy_memory:", tbls.rows.map(r => r.table_name));

  if (tbls.rows.some(r => r.table_name === 'accounts')) {
    const accs = await pool.query("SELECT * FROM accounts;");
    console.log("Accounts:", accs.rows);
  }
  if (tbls.rows.some(r => r.table_name === 'tenants')) {
    const tnts = await pool.query("SELECT * FROM tenants;");
    console.log("Tenants:", tnts.rows);
  }
} catch (e) {
  console.error("Error:", e.message);
} finally {
  await pool.end();
}
