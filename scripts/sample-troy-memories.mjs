import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();

const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const sample = await pool.query(`
    SELECT id, user_id, kind, scope, left(subject, 80) as subject, created_at
    FROM memory_items
    WHERE user_id = 'troy'
    ORDER BY created_at DESC
    LIMIT 10;
  `);
  console.log("10 newest memories for troy in thinkinbuddy_memory:");
  for (const row of sample.rows) {
    console.log(`- [${row.kind}] ${row.subject} (${row.created_at})`);
  }
} catch (e) {
  console.error("Query error:", e.message);
} finally {
  await pool.end();
}
