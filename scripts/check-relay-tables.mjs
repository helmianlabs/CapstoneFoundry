import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const tbls = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public';")).rows.map(r => r.table_name);
  console.log("Current tables in thinkinbuddy_memory:", tbls);
  
  const relayTables = ['helmion_relay', 'helmion_relay_presence', 'relay_devices', 'relay_pairing_codes'];
  for (const t of relayTables) {
    console.log(`Table [${t}] exists:`, tbls.includes(t));
  }
} finally {
  await pool.end();
}
