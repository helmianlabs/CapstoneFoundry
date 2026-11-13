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

// ─── media_content — the database-storage snapshot column ──────────
//
// The gallery's "Store in database" action (Troy's order 2026-11-13)
// puts a built website's or document's full content INTO the database
// row itself, so the page lives in Neon and not only as a Blob link.
// Text artifacts/documents snapshot into memory_items.media_content
// when the user stores them; binary media (image/video/3D) keep the
// row as their catalog record and store nothing here. Same in-code
// DDL pattern as the category guard above; the migration of record is
// docs/migration-media-content-2026-11-13.sql:
//
//   ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS media_content text
//
// Nullable, no default: rows that were never stored carry NULL, which
// the read path (server/handlers/artifact-view.js) reads as "no
// snapshot — serve the Blob as before".

let contentMemo = null;

export function ensureMediaContentColumn(pool) {
  if (!pool || typeof pool.query !== 'function') return Promise.resolve(false);
  if (contentMemo) return contentMemo;
  contentMemo = (async () => {
    try {
      await pool.query(
        `ALTER TABLE memory_items ADD COLUMN IF NOT EXISTS media_content text`
      );
      return true;
    } catch (err) {
      console.error('[memory-schema] media_content column ensure failed:', err?.message || err);
      contentMemo = null; // allow a later call to retry
      return false;
    }
  })();
  return contentMemo;
}

// Test hook: reset the memo between cases.
export function _resetMemorySchemaMemo() {
  memo = null;
  contentMemo = null;
}
