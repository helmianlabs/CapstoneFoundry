import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const u = new URL(workingUrl);
u.pathname = '/claude_memory';

const pool = new pg.Pool({ connectionString: u.toString(), ssl: { rejectUnauthorized: false } });

try {
  const rules = await pool.query('SELECT rule_key, layer, plain_text, enabled FROM librarian_rules');
  console.log('Librarian rules count:', rules.rows.length);
  for (const r of rules.rows) {
    console.log(`[${r.rule_key}] (${r.layer}) enabled=${r.enabled}: ${r.plain_text}`);
  }

  const settings = await pool.query('SELECT * FROM librarian_settings');
  console.log('\nLibrarian settings:', settings.rows);
} finally {
  await pool.end();
}
