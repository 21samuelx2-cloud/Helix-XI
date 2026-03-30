-- Phase 1 multi-tenant foundation for ARIA
-- Run this in Supabase SQL editor before deploying the backend changes.

-- Company integration identity
ALTER TABLE helixxi_companies
  ADD COLUMN IF NOT EXISTS api_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret_hash TEXT,
  ADD COLUMN IF NOT EXISTS webhook_public_id TEXT,
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS integration_status TEXT DEFAULT 'disconnected',
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_helixxi_companies_webhook_public_id
  ON helixxi_companies (webhook_public_id);

-- Core finance tables
ALTER TABLE helixxi_transactions
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

ALTER TABLE helixxi_ledger
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

ALTER TABLE helixxi_holdqueue
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

ALTER TABLE helixxi_forecasts
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

ALTER TABLE helixxi_auditlog
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

ALTER TABLE helixxi_ariamemory
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

ALTER TABLE helixxi_ariajournal
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

ALTER TABLE helixxi_rejectionlog
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

ALTER TABLE helixxi_performance
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

-- Helpful indexes for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_helixxi_transactions_company_id
  ON helixxi_transactions (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_ledger_company_id
  ON helixxi_ledger (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_holdqueue_company_id
  ON helixxi_holdqueue (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_forecasts_company_id
  ON helixxi_forecasts (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_auditlog_company_id
  ON helixxi_auditlog (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_ariamemory_company_id
  ON helixxi_ariamemory (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_ariajournal_company_id
  ON helixxi_ariajournal (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_rejectionlog_company_id
  ON helixxi_rejectionlog (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_performance_company_id
  ON helixxi_performance (company_id);

-- Backfill company-owned onboarding to company-owned rows where possible
ALTER TABLE helixxi_onboarding
  ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL;

UPDATE helixxi_onboarding o
SET company_id = u.company_id
FROM helixxi_users u
WHERE o.user_id = u.id
  AND o.company_id IS NULL
  AND u.company_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_helixxi_onboarding_company_id
  ON helixxi_onboarding (company_id);
