-- migration-memory-category-2026-11-13.sql
--
-- memory_items.category — the librarian filing column.
--
-- server/handlers/memory.js selects and inserts `category` on every
-- memory read/write path (the category is computed by
-- classifyMemoryCategory and used to file rows in memory_filings), but
-- the column was never added to the production table, so recall_memory
-- failed on every call with: column "category" does not exist
-- (proven live 2026-11-13 in real ElevenLabs conversations).
--
-- This statement is applied at runtime by lib/memorySchema.js
-- (ensureMemoryCategoryColumn), following the in-code DDL precedent of
-- memory_extract_cursors in server/handlers/checkpoint-memories.js, so
-- the schema and the code that needs it ship together. It is recorded
-- here as the migration of record and is safe to run by hand as well:
-- idempotent, and existing rows take the same 'general' default the
-- read paths already use when a row carries no category.

ALTER TABLE memory_items
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'general';
