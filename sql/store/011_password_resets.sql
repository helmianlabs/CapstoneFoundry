-- sql/store/011_password_resets.sql — ThinkinBuddy store build,
-- password-reset bite: one-time password reset tokens for the
-- email/password accounts of sql/store/004 (lib/accounts.js).
--
-- RUN ONCE BY US (Helmian Labs) against the shared hosted Neon
-- database, AFTER sql/store/001_tenants.sql (the table references
-- tenants) and after sql/store/004_accounts.sql (the accounts whose
-- passwords these tokens reset). NEVER run by end users.
--
-- Idempotent: safe to re-run. Table and indexes are IF NOT EXISTS.
--
-- Secrets note: this schema stores HASHES only, exactly like
-- sql/store/005_relay.sql's pairing codes. token_hash is the SHA-256
-- of the reset token; the raw token is minted server-side, emailed to
-- the account holder once (lib/mailer.js), lives 30 minutes, and is
-- single-use. Minting a fresh token invalidates the tenant's previous
-- unused tokens (lib/accounts.js mintPasswordResetToken), so at most
-- one live token exists per tenant at any moment.

CREATE TABLE IF NOT EXISTS password_resets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_hash
  ON password_resets (token_hash);

CREATE INDEX IF NOT EXISTS idx_password_resets_tenant
  ON password_resets (tenant_id);
