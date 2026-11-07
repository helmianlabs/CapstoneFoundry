import fs from 'fs';
import pg from 'pg';
const { Pool } = pg;

async function main() {
  const p = new Pool({ connectionString: process.env.DATABASE_URL_MEMORY });
  const migrations = [
    'sql/store/001_tenants.sql',
    'sql/store/002_tenant_columns.sql',
    'sql/store/003_billing.sql',
    'sql/store/004_accounts.sql',
    'sql/store/005_relay.sql',
    'sql/store/006_requests.sql',
    'sql/store/007_profiles_multi.sql',
    'sql/store/008_relay_profile.sql',
    'sql/store/009_content_reports.sql',
    'sql/store/010_memory_extract_cursors.sql',
    'sql/store/011_password_resets.sql',
  ];

  for (const m of migrations) {
    if (!fs.existsSync(m)) continue;
    console.log(`Applying ${m}...`);
    try {
      const sql = fs.readFileSync(m, 'utf8');
      await p.query(sql);
      console.log(`✓ ${m} applied!`);
    } catch (e) {
      console.error(`✗ ${m} error:`, e.message);
    }
  }

  const cols = await p.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'profiles'");
  console.log('Final profiles columns:', cols.rows.map(r => r.column_name));
  await p.end();
}

main();
