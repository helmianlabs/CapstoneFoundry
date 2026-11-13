// lib/memorySchema.js — self-healing schema guard for memory_items.category.
//
// The librarian filing work (classifyMemoryCategory, memory_filings) made
// `category` a first-class column of memory_items: every read path in
// server/handlers/memory.js selects it and every write path inserts it.
// The production table never received the column, so recall_memory failed
// on every call with `column "category" does not exist` (proven live
// 2026-11-13, twice, in real conversations).
//
// The repo's schema changes historically landed as out-of-band SQL (see
// docs/migration-media-memory-2026-06-06.sql, referenced from
// lib/mediaMemory.js but not kept in the tree), with one runtime-DDL
// precedent kept in code (memory_extract_cursors in
// server/handlers/checkpoint-memories.js). This guard follows the in-code
// precedent so the fix ships with the code that needs the column:
//
//   ALTER TABLE memory_items
//     ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'
//
// Idempotent, safe to run on every cold start, and a no-op once the
// column exists. The matching migration is recorded at
// docs/migration-memory-category-2026-11-13.sql.
//
// Failure posture: if the ALTER cannot run (e.g. the DB role lacks DDL
// rights), the guard logs the real error and reports false; callers
// proceed and their queries surface the underlying database error
// unchanged — no failure is hidden, and a later call retries.

let memo = null;

export function ensureMemoryCategoryColumn(pool) {
  if (!pool || typeof pool.query !== 'function') return Promise.resolve(false);
  if (memo) return memo;
  memo = (async () => {
    try {
      await pool.query(
        `ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general'`
      );
      return true;
    } catch (err) {
      console.error('[memory-schema] category column ensure failed:', err?.message || err);
      memo = null; // allow a later call to retry
      return false;
    }
  })();
  return memo;
}

// Test hook: reset the memo between cases.
export function _resetMemorySchemaMemo() {
  memo = null;
}
