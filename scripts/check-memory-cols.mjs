import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", "utf8").trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const cols = await pool.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'memory_items' 
    ORDER BY ordinal_position;
  `);
  console.log("Columns of memory_items in thinkinbuddy_memory:");
  for (const c of cols.rows) {
    console.log(`- ${c.column_name}: ${c.data_type}`);
  }
} catch (e) {
  console.error("Error:", e.message);
} finally {
  await pool.end();
}
