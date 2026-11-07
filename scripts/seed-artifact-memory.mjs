import { saveMediaMemory } from '../lib/mediaMemory.js';
import pg from 'pg';
import fs from 'fs';

const env = fs.readFileSync('E:/CapstoneFoundry/.env.local', 'utf8');
const match = env.match(/DATABASE_URL_MEMORY=["']?([^"'\r\n]+)["']?/);
const pool = new pg.Pool({ connectionString: match[1] });

const usersRes = await pool.query('SELECT DISTINCT user_id, tenant_id FROM memory_items WHERE user_id IS NOT NULL');
for (const row of usersRes.rows) {
  await saveMediaMemory({
    userId: row.user_id,
    tenantId: row.tenant_id,
    type: 'artifact',
    blobUrl: '/landing.html',
    prompt: 'Capstone Foundry High-Converting Landing Page with Spoke Telemetry and Pricing Grid'
  });
  console.log(`Seeded landing.html for user ${row.user_id}`);
}
await pool.end();
