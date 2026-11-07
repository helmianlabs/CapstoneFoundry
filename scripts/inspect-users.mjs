import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();

const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const users = await pool.query(`
    SELECT user_id, count(*)::int as count, max(created_at) as newest
    FROM memory_items
    GROUP BY user_id
    ORDER BY count DESC
  `);
  console.log("Memory items by user_id:");
  for (const row of users.rows) {
    console.log(`- user_id: "${row.user_id}", count: ${row.count}, newest: ${row.newest}`);
  }
} catch (e) {
  console.error("Query error:", e.message);
} finally {
  await pool.end();
}
