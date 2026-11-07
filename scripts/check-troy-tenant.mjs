import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const t = await pool.query("SELECT * FROM tenants WHERE id = '02070cfa-1e7c-4dc1-9bd9-31d9f9d5caf6';");
  console.log("Found tenant:", t.rows);
  
  if (t.rows.length === 0) {
    console.log("Tenant does not exist in thinkinbuddy_memory yet!");
    // Insert it or check accounts!
  }
} finally {
  await pool.end();
}
