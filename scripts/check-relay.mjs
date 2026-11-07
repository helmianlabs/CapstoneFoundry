import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const match = env.match(/DATABASE_URL_MEMORY=["']?([^"'\r\n]+)["']?/);
const conn = match[1];

const pool = new pg.Pool({ connectionString: conn });
const res = await pool.query("SELECT * FROM helmion_relay ORDER BY id DESC LIMIT 5");
console.log(JSON.stringify(res.rows, null, 2));
await pool.end();
