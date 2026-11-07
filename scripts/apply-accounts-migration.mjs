import fs from 'fs';
import pg from 'pg';
const { Pool } = pg;

async function main() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL_MEMORY });
  try {
    const sql004 = fs.readFileSync('sql/store/004_accounts.sql', 'utf8');
    console.log('Applying 004_accounts.sql...');
    await p.query(sql004);
    console.log('004_accounts.sql applied successfully!');

    const sql011 = fs.readFileSync('sql/store/011_password_resets.sql', 'utf8');
    console.log('Applying 011_password_resets.sql...');
    await p.query(sql011);
    console.log('011_password_resets.sql applied successfully!');

    const cols = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants'");
    console.log('New tenants columns:', cols.rows.map(r => r.column_name));
  } catch (err) {
    console.error('Migration error:', err);
  } finally {
    await p.end();
  }
}

main();
