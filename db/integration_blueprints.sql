-- Connection blueprint persistence for ARIA Connect.
-- Run this after multitenant_phase1.sql.

ALTER TABLE helixxi_companies
  ADD COLUMN IF NOT EXISTS integration_mode TEXT DEFAULT 'backend',
  ADD COLUMN IF NOT EXISTS integration_provider_profile TEXT DEFAULT 'custom',
  ADD COLUMN IF NOT EXISTS integration_expected_source TEXT;
