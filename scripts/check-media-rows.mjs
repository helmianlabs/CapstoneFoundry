import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const res = await pool.query(`
    SELECT id, kind, subject, blob_url, created_at, tenant_id
    FROM memory_items
    WHERE kind IN ('image', 'video') OR blob_url IS NOT NULL
    ORDER BY created_at DESC;
  `);
  console.log(`Media items count: ${res.rows.length}`);
  console.table(res.rows.slice(0, 10));
} finally {
  await pool.end();
}
