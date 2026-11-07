import pg from 'pg';
import fs from 'fs';

const raw = fs.readFileSync('C:/Users/troyh/.claude.json', 'utf8');
const matches = [...new Set(raw.match(/postgres(?:ql)?:\/\/[^"'\s\\]+neon\.tech\/[^\s"'\\]+/g))];

console.log(`Found ${matches.length} unique connection strings.`);

for (const connStr of matches) {
  const clean = connStr.replace(/\\u0026/g, '&');
  const u = new URL(clean);
  console.log(`\nTesting ${u.host} (${u.pathname})...`);

  // Try original pathname and /thinkinbuddy_memory
  const targets = [u.pathname, '/thinkinbuddy_memory'];
  for (const dbName of targets) {
    const targetUrl = clean.replace(u.pathname, dbName);
    const pool = new pg.Pool({ connectionString: targetUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000 });
    try {
      const res = await pool.query("SELECT current_database(), to_regclass('public.memory_items') as tbl;");
      console.log(`  -> SUCCESS on ${dbName}: DB=${res.rows[0].current_database}, memory_items table=${res.rows[0].tbl}`);
      if (res.rows[0].tbl) {
        const count = await pool.query("SELECT count(*) FROM memory_items;");
        console.log(`     Total rows in memory_items: ${count.rows[0].count}`);
        
        // Save this working URL!
        fs.writeFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", targetUrl);
        console.log(`     SAVED working memory URL!`);
      }
    } catch (e) {
      console.log(`  -> Failed on ${dbName}: ${e.message}`);
    } finally {
      await pool.end();
    }
  }
}
