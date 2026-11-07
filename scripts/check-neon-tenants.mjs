import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const tenants = await pool.query("SELECT * FROM tenants;");
  console.log("Tenants in thinkinbuddy_memory:", tenants.rows);
} catch (e) {
  console.error("Error querying tenants:", e.message);
} finally {
  await pool.end();
}
