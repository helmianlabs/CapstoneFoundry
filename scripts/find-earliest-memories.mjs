import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const countRes = await pool.query("SELECT count(*)::int as total FROM memory_items;");
  console.log("Total memories in DB:", countRes.rows[0].total);

  const earliestRes = await pool.query(`
    SELECT id, kind, subject, content, created_at, updated_at
    FROM memory_items
    ORDER BY created_at ASC
    LIMIT 10;
  `);
  console.log("\n10 Earliest memories in DB:");
  for (const r of earliestRes.rows) {
    const date = r.created_at ? r.created_at.toISOString().split('T')[0] : 'no-date';
    console.log(`- [${date}] (${r.kind}) "${r.subject}": ${r.content}`);
  }
} finally {
  await pool.end();
}
