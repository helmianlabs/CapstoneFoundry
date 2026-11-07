import pg from 'pg';
import fs from 'fs';

const envContent = fs.readFileSync("E:/CapstoneFoundry/.env.local", "utf8");
let dbUrl = "";
for (const line of envContent.split("\n")) {
  if (line.startsWith("DATABASE_URL_MEMORY=")) {
    dbUrl = line.substring("DATABASE_URL_MEMORY=".length).trim().replace(/^["']|["']$/g, '');
  }
}

const pool = new pg.Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });

try {
  const currentDb = await pool.query("SELECT current_database()");
  console.log("Connected to Neon! Current DB:", currentDb.rows[0].current_database);
  
  const dbs = await pool.query("SELECT datname FROM pg_database WHERE datistemplate = false;");
  console.log("Databases on cluster:", dbs.rows.map(r => r.datname));
  
  const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public';");
  console.log("Tables in current DB:", tables.rows.map(r => r.table_name));
} catch (err) {
  console.error("Connection error:", err.message);
} finally {
  await pool.end();
}
