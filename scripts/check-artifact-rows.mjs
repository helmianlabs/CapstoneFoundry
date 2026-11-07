import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const match = env.match(/DATABASE_URL_MEMORY=["']?([^"'\r\n]+)["']?/);
const pool = new pg.Pool({ connectionString: match[1] });

const res = await pool.query("SELECT id, user_id, tenant_id, kind, subject, blob_url FROM memory_items WHERE kind = 'artifact'");
console.log(JSON.stringify(res.rows, null, 2));

const allKinds = await pool.query("SELECT DISTINCT kind, user_id FROM memory_items");
console.log('All kinds and user_ids:', allKinds.rows);

await pool.end();
