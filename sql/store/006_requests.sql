-- sql/store/006_requests.sql — ThinkinBuddy store build, unified
-- requests bite B1: ONE suggestion box for everything a user wishes
-- the Buddy had — a missing tool/provider AND curriculum (a new
-- subject, a new level). Design: docs in ~/workspace/thinkinbuddy-launch/
-- curriculum-requests-spec.md §1 (this file replaces the provider-only
-- 006_provider_requests.sql the inventory specced — that file was
-- never created; the unified table below is the one that ships).
--
-- RUN ONCE BY US (Helmian Labs) against the shared hosted Neon
-- database, AFTER sql/store/001_tenants.sql (the tenant_id below
-- references tenants). NEVER run by end users.
--
-- Idempotent: safe to re-run. Table and index are IF NOT EXISTS.
--
-- A request is a SUGGESTION, never a control surface: the row carries
-- only the kind, the kind's whitelisted payload, and a status. There
-- is deliberately no column a request could use to reach the tenant's
-- plan, credit bucket, or profile safety decision — those live in
-- entitlements / tenant_credit_grants / profiles and nothing here
-- joins to them for writing.
--
-- Statuses (spec §1.2 — the requester-facing labels live in
-- lib/requests.js STATUS_LABELS): new → listed → building →
-- verifying (curriculum kind ONLY) → shipped, with not_planned as
-- the honest no. Movement is operator-side only (Troy's desk); the
-- requester's API can create and read, never move. The transition
-- rules are enforced in lib/requests.js (canTransition /
-- setRequestStatus); the CHECK below only fences the vocabulary.

CREATE TABLE IF NOT EXISTS requests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('provider', 'curriculum')),
  payload    JSONB NOT NULL,
  status     TEXT NOT NULL DEFAULT 'new'
             CHECK (status IN ('new', 'listed', 'building', 'verifying', 'shipped', 'not_planned')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The requester's read is "my requests, newest first"; the desk read
-- is the same shape across tenants. One index serves both.
CREATE INDEX IF NOT EXISTS idx_requests_tenant_created
  ON requests (tenant_id, created_at DESC);
