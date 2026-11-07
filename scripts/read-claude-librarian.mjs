import pg from 'pg';

const claudeConn = "postgresql://neondb_owner:npg_u3bKq1lZfRvh@ep-ancient-hill-a5qg9f0y.us-east-2.aws.neon.tech/claude_memory?sslmode=require";
const client = new pg.Client({ connectionString: claudeConn });
await client.connect();

const settings = await client.query('SELECT * FROM librarian_settings');
console.log('Librarian settings:', settings.rows);

const rules = await client.query('SELECT rule_key, layer, plain_text, enabled FROM librarian_rules');
console.log('Librarian rules count:', rules.rows.length);
console.log('Sample rules:', rules.rows.slice(0, 5));

await client.end();
