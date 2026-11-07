import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const u = new URL(workingUrl);
u.pathname = '/claude_memory';

const pool = new pg.Pool({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });

try {
  const tbls = await pool.query(`
    SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
  `);
  console.log("Tables in claude_memory:", tbls.rows.map(r => r.table_name));

  for (const tbl of ['memory_categories', 'librarian_settings', 'librarian_rules', 'helmion_relay']) {
    try {
      const cols = await pool.query(`
        SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position;
      `, [tbl]);
      console.log(`\nColumns of [${tbl}]:`, cols.rows.map(c => `${c.column_name}: ${c.data_type}`));
      
      const count = await pool.query(`SELECT count(*)::int as n FROM ${tbl};`);
      console.log(`Row count of [${tbl}]:`, count.rows[0].n);
    } catch (e) {
      console.log(`Table [${tbl}] error:`, e.message);
    }
  }
} finally {
  await pool.end();
}
