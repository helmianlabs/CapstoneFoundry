-- sql/store/007_profiles_multi.sql — ThinkinBuddy store build, safety
-- wiring bite 9 (safety-gap-map §7): child profiles inside one account.
--
-- RUN ONCE BY US (Helmian Labs) against the shared hosted Neon
-- database, after 001-006. NEVER run by end users. Operator-side only,
-- exactly like 001-006 — and NOT run by the bite that authored it:
-- it lands with the deploy, through the same gate as 006.
--
-- Until this runs, the live database still has the 001 shape (one
-- profile per tenant, tenant_id as the primary key). The bite-9 code
-- names the new columns, so code and this migration deploy together.
--
-- What it does: profiles stop being one-row-per-tenant. Each profile
-- gains a stable profile_id, an is_primary flag (the account's first
-- profile — the row that also carries the account's parent PIN hash),
-- and an is_active flag (the profile sessions currently run under).
-- The primary key becomes (tenant_id, profile_id). Backfill: every
-- pre-existing row is its tenant's first profile, so it becomes
-- primary AND active — existing accounts behave exactly as before.
--
-- The two partial unique indexes keep the model's invariants in the
-- schema itself: at most one primary and at most one active profile
-- per tenant, however the rows are written.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS profile_id UUID;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_active  BOOLEAN NOT NULL DEFAULT false;

-- Per-row ids for the backfill (gen_random_uuid is pgcrypto, enabled
-- by 001; PG 13+ also has it built in).
UPDATE profiles SET profile_id = gen_random_uuid() WHERE profile_id IS NULL;

-- Pre-007 there is exactly one row per tenant, so flagging every
-- existing row primary + active is the backfill, not a guess.
UPDATE profiles SET is_primary = true, is_active = true
 WHERE is_primary = false AND is_active = false;

ALTER TABLE profiles ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE profiles ALTER COLUMN profile_id SET DEFAULT gen_random_uuid();

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_pkey;
ALTER TABLE profiles ADD PRIMARY KEY (tenant_id, profile_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_one_primary
  ON profiles (tenant_id) WHERE is_primary;
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_one_active
  ON profiles (tenant_id) WHERE is_active;
