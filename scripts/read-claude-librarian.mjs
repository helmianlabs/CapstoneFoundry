import pg from 'pg';

const claudeConn = process.env.NEON_CLAUDE_MEMORY_URL;
const client = new pg.Client({ connectionString: claudeConn });
await client.connect();

const settings = await client.query('SELECT * FROM librarian_settings');
console.log('Librarian settings:', settings.rows);

const rules = await client.query('SELECT rule_key, layer, plain_text, enabled FROM librarian_rules');
console.log('Librarian rules count:', rules.rows.length);
console.log('Sample rules:', rules.rows.slice(0, 5));

await client.end();
