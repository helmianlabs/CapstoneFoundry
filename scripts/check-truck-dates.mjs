import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const res = await pool.query(`
    SELECT id, subject, content, category, created_at, updated_at, tenant_id 
    FROM memory_items 
    WHERE content ILIKE '%247%' OR subject ILIKE '%247%' OR subject ILIKE '%truck%'
    ORDER BY created_at ASC;
  `);
  console.table(res.rows);
} finally {
  await pool.end();
}
