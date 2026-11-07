import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const u = new URL(workingUrl);
u.pathname = '/claude_memory';

const pool = new pg.Pool({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });

try {
  for (const tbl of ['memory_unsorted', 'memory_filings', 'memory_moves', 'memory_categories']) {
    const cols = await pool.query(`
      SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position;
    `, [tbl]);
    console.log(`\nColumns of [${tbl}]:`, cols.rows.map(c => `${c.column_name}: ${c.data_type}`));
    const rows = await pool.query(`SELECT * FROM ${tbl} LIMIT 3;`);
    console.log(`Sample rows of [${tbl}]:`, rows.rows);
  }
} finally {
  await pool.end();
}
