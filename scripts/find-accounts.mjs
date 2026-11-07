import pg from 'pg';
const { Pool } = pg;

async function check(name, connStr) {
  if (!connStr) return;
  console.log('--- Checking', name, '---');
  const p = new Pool({ connectionString: connStr });
  try {
    const t = await p.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    console.log(name, 'tables:', t.rows.map(r => r.table_name));
    for (const table of ['tenants', 'users', 'accounts', 'auth_users']) {
      if (t.rows.some(r => r.table_name === table)) {
        const cols = await p.query(`SELECT column_name FROM information_schema.columns WHERE table_name = '${table}'`);
        console.log(table, 'cols:', cols.rows.map(r => r.column_name));
        const data = await p.query(`SELECT * FROM ${table} LIMIT 10`);
        console.log(table, 'rows:', data.rows);
      }
    }
  } catch (e) {
    console.error(name, 'error:', e.message);
  } finally {
    await p.end();
  }
}

async function main() {
  await check('DATABASE_URL', process.env.DATABASE_URL);
  await check('DATABASE_URL_MEMORY', process.env.DATABASE_URL_MEMORY);
}

main();
