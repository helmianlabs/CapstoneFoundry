import pg from 'pg';
import fs from 'fs';

const workingUrl = fs.readFileSync('E:/CapstoneFoundry/scripts/working-memory-url.txt', 'utf8').trim();
const pool = new pg.Pool({ connectionString: workingUrl, ssl: { rejectUnauthorized: false } });

try {
  await pool.query("BEGIN;");

  // 1. Add category column to memory_items
  await pool.query(`
    ALTER TABLE memory_items 
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general';
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_memory_items_category 
    ON memory_items (tenant_id, category);
  `);

  // 2. Create memory_categories table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memory_categories (
      slug TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // 3. Seed starter standard categories
  const defaultCategories = [
    { slug: 'business', name: 'Business & Operations', description: 'Company strategy, ventures, clients, contracts, and revenue' },
    { slug: 'build', name: 'Software & Builds', description: 'Code architecture, features, tools, repositories, and technical setups' },
    { slug: 'personal', name: 'Personal & Life', description: 'Family, friends, health, daily routines, and personal goals' },
    { slug: 'learning', name: 'Learning & Skills', description: 'Courses, topics studied, languages, books, and educational notes' },
    { slug: 'finance', name: 'Finance & Money', description: 'Budgets, rates, financial plans, banking, and investments' }
  ];

  for (const cat of defaultCategories) {
    await pool.query(`
      INSERT INTO memory_categories (slug, name, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (slug) DO NOTHING;
    `, [cat.slug, cat.name, cat.description]);
  }

  // 4. Backfill existing memory_items with best-effort category heuristic
  await pool.query(`
    UPDATE memory_items 
    SET category = 'business'
    WHERE category = 'general' 
      AND (subject ILIKE '%dairyforge%' OR subject ILIKE '%tms%' OR subject ILIKE '%client%' OR subject ILIKE '%contract%' OR subject ILIKE '%business%');
  `);

  await pool.query(`
    UPDATE memory_items 
    SET category = 'build'
    WHERE category = 'general' 
      AND (subject ILIKE '%tool%' OR subject ILIKE '%app%' OR subject ILIKE '%code%' OR subject ILIKE '%pipeline%' OR subject ILIKE '%endpoint%' OR subject ILIKE '%widget%');
  `);

  await pool.query(`
    UPDATE memory_items 
    SET category = 'learning'
    WHERE category = 'general' 
      AND (subject ILIKE '%spanish%' OR subject ILIKE '%curriculum%' OR subject ILIKE '%knowledge%');
  `);

  await pool.query("COMMIT;");
  console.log("Successfully added Librarian category schema and backfilled categories in thinkinbuddy_memory!");

  const catCounts = await pool.query(`
    SELECT category, count(*)::int as count 
    FROM memory_items 
    GROUP BY category 
    ORDER BY count DESC;
  `);
  console.log("\nMemories by Category in Neon:");
  for (const row of catCounts.rows) {
    console.log(`- ${row.category}: ${row.count}`);
  }
} catch (e) {
  await pool.query("ROLLBACK;");
  console.error("Migration error:", e);
} finally {
  await pool.end();
}
