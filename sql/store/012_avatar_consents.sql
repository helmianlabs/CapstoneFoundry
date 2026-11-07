-- 012_avatar_consents.sql — Digital Avatar & Likeness Release Governance
-- Compliant with California AB 2602 / AB 1836, NO FAKES Act, and App Store Guideline 5.1

CREATE TABLE IF NOT EXISTS avatar_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  photo_url TEXT NOT NULL,
  voice_id TEXT,
  is_active BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_avatar_profiles_tenant ON avatar_profiles(tenant_id);

CREATE TABLE IF NOT EXISTS avatar_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  avatar_id UUID REFERENCES avatar_profiles(id) ON DELETE CASCADE,
  subject_name TEXT NOT NULL,
  consent_type TEXT NOT NULL DEFAULT 'self', -- 'self', 'written_authorization', 'guardian'
  statutory_basis TEXT NOT NULL DEFAULT 'CA_AB_2602_AB_1836',
  statement TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  signed_at TIMESTAMPTZ DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_avatar_consents_tenant ON avatar_consents(tenant_id);
