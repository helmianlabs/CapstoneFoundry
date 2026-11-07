import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  console.log('--- Applying Complete Librarian Tables to Neon thinkinbuddy_memory ---');

  // 1. memory_categories
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_categories (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      parent_slug TEXT,
      description TEXT,
      rulebook TEXT DEFAULT 'preset-d',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('memory_categories table ready');

  // Seed default categories if empty
  const defaultCats = [
    { slug: 'business', name: 'Business & Operations', description: 'DFA, trucking, DairyForge, customers, pricing, sales, contracts, TMS, bids' },
    { slug: 'build', name: 'Build & Engineering', description: 'Code, APIs, apps, deployments, bugs, architecture, database, tech stack' },
    { slug: 'personal', name: 'Personal & Family', description: 'Family, friends, health, life stories, home, hobbies, daily life' },
    { slug: 'learning', name: 'Learning & Skills', description: 'Spanish, languages, tutoring, curriculum, lessons, Feynman loop' },
    { slug: 'finance', name: 'Finance & Banking', description: 'Money, revenue, expenses, credit, loans, billing, investments' },
    { slug: 'general', name: 'General & Miscellaneous', description: 'General preferences, uncategorized facts, miscellaneous notes' }
  ];

  for (const cat of defaultCats) {
    await pool.query(`
      INSERT INTO memory_categories (slug, name, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO UPDATE
      SET name = EXCLUDED.name, description = EXCLUDED.description;
    `, [cat.slug, cat.name, cat.description]);
  }
  console.log('Default categories seeded.');

  // 2. librarian_rules
  await pool.query(`
    CREATE TABLE IF NOT EXISTS librarian_rules (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID,
      rule_key TEXT NOT NULL,
      category TEXT NOT NULL REFERENCES memory_categories(slug),
      layer TEXT DEFAULT 'content',
      pattern TEXT,
      plain_text TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_librarian_rules_tenant ON librarian_rules(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_librarian_rules_category ON librarian_rules(category);
  `);
  console.log('librarian_rules table ready');

  // 3. memory_filings
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_filings (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID,
      memory_id TEXT,
      category TEXT NOT NULL REFERENCES memory_categories(slug),
      tags TEXT[] DEFAULT '{}',
      rule_key TEXT,
      explanation TEXT,
      filed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_memory_filings_tenant ON memory_filings(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_memory_filings_category ON memory_filings(category);
    CREATE INDEX IF NOT EXISTS idx_memory_filings_memory ON memory_filings(memory_id);
  `);
  console.log('memory_filings table ready');

  // Verify memory_items category column and index
  await pool.query(`
    ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
    CREATE INDEX IF NOT EXISTS idx_memory_items_category ON memory_items(category);
  `);
  console.log('memory_items category column and index verified');

  const summary = await pool.query(`
    SELECT category, COUNT(*)::int as count FROM memory_items GROUP BY category ORDER BY count DESC;
  `);
  console.log('\nCurrent Memory Items breakdown by category:');
  console.table(summary.rows);

} finally {
  await pool.end();
}
