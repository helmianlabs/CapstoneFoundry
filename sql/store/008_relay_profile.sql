-- sql/store/008_relay_profile.sql — Capstone Foundry store build, relay
-- bite R1: the active-profile stamp for hosted relay messages.
--
-- RUN ONCE BY US (Helmian Labs) against the shared hosted Neon
-- database, AFTER sql/store/005_relay.sql (helmion_relay and its
-- tenant_id) and sql/store/007_profiles_multi.sql (profiles gains
-- profile_id). NEVER run by end users.
--
-- Idempotent: safe to re-run. The column add is IF NOT EXISTS inside
-- the same guarded block shape as 005.
--
-- WHY: since bite 9 a tenant's profiles are a collection and exactly
-- one is ACTIVE — the profile the session runs under. Hosted relay
-- rows already record the tenant explicitly (005's tenant_id); this
-- records the profile too. relay-http resolves it server-side from
-- the authenticated tenant at send time (its own active pointer,
-- lib/profile.js getProfile) — the client never supplies it and no
-- request field is read for it, so a relay line is attributable to
-- the profile that was live when it was sent.
--
-- No foreign key, deliberately: profiles' primary key is the
-- composite (tenant_id, profile_id), and the stamp is historical
-- annotation — it must survive the profile it names being deleted.
-- Compat-mode writes, and hosted writes whose tenant has no
-- resolvable profile, leave profile_id NULL. relay-http also
-- tolerates this column not existing yet (a missing-column error on
-- the stamped insert falls back to the tenant-stamped insert), so
-- running this file is not a deploy gate for the relay itself.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_name = 'helmion_relay'
  ) THEN
    ALTER TABLE helmion_relay
      ADD COLUMN IF NOT EXISTS profile_id UUID;
    CREATE INDEX IF NOT EXISTS idx_helmion_relay_profile
      ON helmion_relay (profile_id);
  END IF;
END $$;
