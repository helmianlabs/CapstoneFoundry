import pg from 'pg';
const { Pool } = pg;

async function main() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL_MEMORY });
  try {
    const cols = await p.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'profiles'");
    console.log('PROFILES COLS:', cols.rows.map(r => r.column_name));
    const rows = await p.query('SELECT * FROM profiles LIMIT 5');
    console.log('PROFILES ROWS:', rows.rows);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await p.end();
  }
}

main();
