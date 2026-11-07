import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const res = await pool.query(`
    SELECT id, subject, content, category, created_at
    FROM memory_items
    WHERE created_at >= '2026-11-06T00:00:00Z'
    ORDER BY created_at ASC;
  `);
  console.log(`Rows created today (${res.rows.length}):`);
  console.table(res.rows);
} finally {
  await pool.end();
}
