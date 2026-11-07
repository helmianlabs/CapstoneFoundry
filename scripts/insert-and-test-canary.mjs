import pg from 'pg';
import fs from 'fs';
import { embed, vecLiteral } from '../server/handlers/memory.js';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

const targetTenantId = '02070cfa-1e7c-4dc1-9bd9-31d9f9d5caf6';
const canaryKey = 'canary_passcode';
const canaryValue = 'BLUE-EAGLE-942';

// 1. Embed canary
let vec = null;
try {
  vec = await embed(`${canaryKey}: ${canaryValue}`);
  console.log("Embedded canary successfully, dimensions:", vec.length);
} catch (e) {
  console.log("Embed error:", e.message);
}

// 2. Insert into Neon
const insertSql = `
  INSERT INTO memory_items (
    id, tenant_id, user_id, scope, kind, subject, content, embedding, confidence, importance, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), $1, 'troy', 'semantic', 'fact', $2, $3, ${vec ? '$4::vector' : 'NULL'}, 1.0, 1.0, now(), now()
  )
  RETURNING id, subject, content, tenant_id;
`;

const params = [targetTenantId, canaryKey, canaryValue];
if (vec) params.push(vecLiteral(vec));

const res = await pool.query(insertSql, params);
console.log("Inserted canary row into Neon DB:", res.rows[0]);

// 3. Test recall against live Vercel endpoint
const testRecall = await fetch("https://thinkbuddy-sandy.vercel.app/api/recall-memory", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Webhook-Secret": "2473b84d26f2048e11875e23d20c476e91f0c09427424cabdd826f3a8c6d06ea"
  },
  body: JSON.stringify({
    userId: targetTenantId,
    query: "canary passcode"
  })
});

const recallData = await testRecall.json();
console.log("\nLive API Recall Test for 'canary passcode':");
console.log("Status:", testRecall.status);
console.log("Found:", recallData.found);
console.log("Summary:\n", recallData.summary);

await pool.end();
