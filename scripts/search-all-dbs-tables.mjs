import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();
const u = new URL(workingUrl);

const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });
const dbs = (await pool.query("SELECT datname FROM pg_database WHERE datistemplate = false;")).rows.map(r => r.datname);
await pool.end();

for (const db of dbs) {
  const targetUrl = new URL(workingUrl);
  targetUrl.pathname = '/' + db;
  const dbPool = new pg.Pool({ connectionString: targetUrl.toString(), ssl: { rejectUnauthorized: false } });
  try {
    const res = await dbPool.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema='public' AND (table_name LIKE '%account%' OR table_name LIKE '%tenant%' OR table_name = 'profiles')
    `);
    if (res.rows.length > 0) {
      console.log(`DB [${db}] has matching tables:`, res.rows.map(r => r.table_name));
    }
  } catch (e) {
    // skip
  } finally {
    await dbPool.end();
  }
}
