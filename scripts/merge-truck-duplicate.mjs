import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  // Update original June 3 row to incorporate DFA mention
  await pool.query(`
    UPDATE memory_items
    SET content = 'Troy has experience driving trucks for DFA, specifically driving truck 247 hauling milk.',
        category = 'business'
    WHERE id = '7d953dc4-bdee-42d7-88a8-e42362ffccb1';
  `);

  // Delete duplicate created today
  await pool.query(`
    DELETE FROM memory_filings WHERE memory_id = 'a4515452-7beb-4ba2-bf09-5cc9c46cf500';
    DELETE FROM memory_items WHERE id = 'a4515452-7beb-4ba2-bf09-5cc9c46cf500';
  `);

  console.log('Merged truck 247 duplicate into the original June 3, 2026 record.');

  const res = await pool.query(`
    SELECT id, subject, content, category, created_at
    FROM memory_items
    WHERE id = '7d953dc4-bdee-42d7-88a8-e42362ffccb1';
  `);
  console.log('Authoritative truck row:');
  console.table(res.rows);
} finally {
  await pool.end();
}
