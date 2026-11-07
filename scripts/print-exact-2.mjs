import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

const res = await pool.query(`
  SELECT id, subject, content, category, created_at, updated_at
  FROM memory_items 
  WHERE id IN ('7d953dc4-bdee-42d7-88a8-e42362ffccb1', 'a4515452-7beb-4ba2-bf09-5cc9c46cf500')
`);
console.log(JSON.stringify(res.rows, null, 2));
await pool.end();
