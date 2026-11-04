-- sql/store/009_content_reports.sql — Capstone Foundry store build:
-- in-app reporting for AI-generated content. Google Play's
-- AI-generated content policy requires a way for users to flag or
-- report offensive AI content from inside the app; Apple expects
-- the same of apps that surface generated content. The two report
-- surfaces (the media gallery's lightbox, and a control beside the
-- transcript) POST here via server/handlers/safety-report.js.
--
-- RUN ONCE BY US (Helmian Labs) against the shared hosted Neon
-- database, AFTER sql/store/001_tenants.sql (the tenant_id below
-- references tenants). NEVER run by end users.
--
-- Idempotent: safe to re-run. Table and index are IF NOT EXISTS.
--
-- A report is a FLAG FOR HUMAN REVIEW, never a control surface:
-- filing one changes nothing by itself — no status pipeline, no
-- automatic action against any account or content. The row carries
-- only what a reviewer needs: which tenant reported, what kind of
-- surface it came from, the media URL or the answer excerpt, and an
-- optional reason in the reporter's own words. Excerpts are capped
-- at 2000 characters in lib/reports.js before they reach this
-- table. tenant_id is ON DELETE CASCADE, so account deletion
-- (lib/accounts.js) erases a tenant's filed reports with the rest of
-- their data.

CREATE TABLE IF NOT EXISTS content_reports (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    TEXT,
  kind       TEXT NOT NULL CHECK (kind IN ('media', 'answer')),
  media_url  TEXT,
  excerpt    TEXT,
  reason     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The reviewer's read is "reports, newest first", per tenant or
-- across tenants. One index serves both.
CREATE INDEX IF NOT EXISTS idx_content_reports_tenant_created
  ON content_reports (tenant_id, created_at DESC);
