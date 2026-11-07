import pg from 'pg';
import fs from 'fs';
import { embed, vecLiteral } from '../server/handlers/memory.js';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

const legacyTenantId = '00000000-0000-4000-8000-000000000001';
const canaryKey = 'canary_passcode';
const canaryValue = 'BLUE-EAGLE-942';

const vec = await embed(`${canaryKey}: ${canaryValue}`);

const insertSql = `
  INSERT INTO memory_items (
    id, tenant_id, user_id, scope, kind, subject, content, embedding, confidence, importance, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), $1, 'troy', 'semantic', 'fact', $2, $3, $4::vector, 1.0, 1.0, now(), now()
  )
  RETURNING id, subject, content, tenant_id;
`;

const res = await pool.query(insertSql, [legacyTenantId, canaryKey, canaryValue, vecLiteral(vec)]);
console.log("Inserted canary row for legacy tenant into Neon DB:", res.rows[0]);

await pool.end();
