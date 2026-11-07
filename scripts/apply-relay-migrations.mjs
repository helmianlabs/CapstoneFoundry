import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const relaySql = fs.readFileSync('E:/CapstoneFoundry/sql/relay.sql', 'utf8');
  await pool.query(relaySql);
  console.log("Applied sql/relay.sql to thinkinbuddy_memory!");

  const storeRelaySql = fs.readFileSync('E:/CapstoneFoundry/sql/store/005_relay.sql', 'utf8');
  await pool.query(storeRelaySql);
  console.log("Applied sql/store/005_relay.sql to thinkinbuddy_memory!");

  const tbls = (await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public';")).rows.map(r => r.table_name);
  console.log("Updated tables in thinkinbuddy_memory:", tbls);
} finally {
  await pool.end();
}
