-- migration-media-content-2026-11-13.sql
--
-- memory_items.media_content — the gallery database-storage snapshot.
--
-- Troy's order (2026-11-13): a way for the user, on their phone, to
-- send any gallery item into the Neon database and get it back. For
-- text artifacts (built websites) and documents, storing snapshots the
-- item's full content into this column, so the page truly lives in
-- the database row and not only as a Vercel Blob link; the gallery
-- viewer serves the snapshot when one is present
-- (server/handlers/artifact-view.js). Binary media (image, video,
-- 3D model) store nothing here — their row stays the catalog record
-- (name, type, blob_url, category='stored').
--
-- This statement is applied at runtime by lib/memorySchema.js
-- (ensureMediaContentColumn), following the in-code DDL precedent of
-- the category column (docs/migration-memory-category-2026-11-13.sql),
-- so the schema and the code that needs it ship together. It is
-- recorded here as the migration of record and is safe to run by
-- hand as well: idempotent, nullable, no default — rows that were
-- never stored keep NULL.

ALTER TABLE memory_items
  ADD COLUMN IF NOT EXISTS media_content text;
