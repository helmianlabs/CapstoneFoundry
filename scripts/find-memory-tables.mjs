import pg from 'pg';
import fs from 'fs';

const raw = fs.readFileSync('C:/Users/troyh/.claude.json', 'utf8');
const matches = [...new Set(raw.match(/postgres(?:ql)?:\/\/[^"'\s\\]+neon\.tech\/[^\s"'\\]+/g))];

for (const connStr of matches) {
  const clean = connStr.replace(/\\u0026/g, '&');
  const u = new URL(clean);
  console.log(`\nInspecting cluster: ${u.host}`);
  
  const pool = new pg.Pool({ connectionString: clean, ssl: { rejectUnauthorized: false } });
  try {
    const dbs = await pool.query("SELECT datname FROM pg_database WHERE datistemplate = false;");
    console.log("Databases on this cluster:", dbs.rows.map(r => r.datname));
    
    // Check if thinkinbuddy_memory exists on this cluster
    for (const dbRow of dbs.rows) {
      const dbName = dbRow.datname;
      const targetUrl = new URL(clean);
      targetUrl.pathname = '/' + dbName;
      const dbPool = new pg.Pool({ connectionString: targetUrl.toString(), ssl: { rejectUnauthorized: false } });
      try {
        const tbls = await dbPool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public';");
        console.log(`  Database [${dbName}] tables:`, tbls.rows.map(r => r.table_name));
        if (tbls.rows.some(r => r.table_name === 'memory_items')) {
          const rowCount = await dbPool.query("SELECT count(*) FROM memory_items;");
          console.log(`    FOUND memory_items in ${dbName}! Total rows:`, rowCount.rows[0].count);
          fs.writeFileSync("E:/CapstoneFoundry/scripts/working-memory-url.txt", targetUrl.toString());
        }
      } catch (err) {
        console.log(`  Database [${dbName}] query error:`, err.message);
      } finally {
        await dbPool.end();
      }
    }
  } catch (e) {
    console.log("Cluster error:", e.message);
  } finally {
    await pool.end();
  }
}
