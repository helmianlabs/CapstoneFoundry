-- 010_memory_extract_cursors.sql — during-session memory autosave cursor.
-- Part of the 2026-11-05 memory-fix bite (server/handlers/checkpoint-memories.js).
--
-- One row per live conversation session: the highest conversation_turns
-- turn_index whose content has already been through memory extraction.
-- Checkpoints extract only turns past the cursor, so a dropped call
-- loses at most the turns since the last checkpoint.
--
-- NOTE: the checkpoint handler also runs this DDL lazily
-- (CREATE TABLE IF NOT EXISTS) on first use, so the feature works even
-- if this file has not been applied yet. Applying it here keeps the
-- schema record complete.
CREATE TABLE IF NOT EXISTS memory_extract_cursors (
  session_id      UUID PRIMARY KEY REFERENCES conversation_sessions(id) ON DELETE CASCADE,
  conversation_id TEXT,
  last_turn_index INT NOT NULL DEFAULT -1,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
