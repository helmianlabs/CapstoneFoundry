import pg from 'pg';
import fs from 'fs';
import { classifyMemoryCategory } from '../server/handlers/memory.js';

console.log('Testing classifyMemoryCategory:');
console.log('truck 247 ->', classifyMemoryCategory('truck', 'hauling milk for DFA in truck 247'));
console.log('git deployment ->', classifyMemoryCategory('git', 'pushing to Vercel deployment'));
console.log('spanish ->', classifyMemoryCategory('spanish', 'practicing Spanish with a tutor'));
console.log('mortgage ->', classifyMemoryCategory('mortgage', 'interest rate on car loans'));
console.log('dad ->', classifyMemoryCategory('family', 'visiting dad in Idaho'));

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  const filings = await pool.query(`SELECT count(*)::int as n FROM memory_filings`);
  console.log('Initial memory_filings count:', filings.rows[0].n);
} finally {
  await pool.end();
}
