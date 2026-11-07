import pg from 'pg';
import fs from 'fs';
import { classifyMemoryCategory } from '../server/handlers/memory.js';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const items = await pool.query(`SELECT id, tenant_id, subject, content, category, created_at FROM memory_items`);
  console.log(`Backfilling filings for ${items.rows.length} memory items...`);

  let count = 0;
  for (const item of items.rows) {
    const cat = item.category && item.category !== 'general' ? item.category : classifyMemoryCategory(item.subject, item.content);
    // update category on memory_items if it was general but classify found better
    if (item.category !== cat) {
      await pool.query(`UPDATE memory_items SET category = $1 WHERE id = $2`, [cat, item.id]);
    }

    await pool.query(`
      INSERT INTO memory_filings (tenant_id, memory_id, category, rule_key, explanation, filed_at)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      item.tenant_id,
      String(item.id),
      cat,
      `librarian.backfill.${cat}`,
      `Librarian backfill filing: ${cat}`,
      item.created_at || new Date()
    ]);
    count++;
  }

  console.log(`Successfully backfilled ${count} filings into memory_filings.`);

  const summary = await pool.query(`
    SELECT category, count(*)::int as count FROM memory_items GROUP BY category ORDER BY count DESC;
  `);
  console.log('Updated category breakdown:');
  console.table(summary.rows);

  const filingSummary = await pool.query(`
    SELECT category, count(*)::int as count FROM memory_filings GROUP BY category ORDER BY count DESC;
  `);
  console.log('Filing breakdown:');
  console.table(filingSummary.rows);

} finally {
  await pool.end();
}
