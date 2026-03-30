-- Integration trust and observability hardening for ARIA Connect.
-- Run this after multitenant_phase1.sql.

ALTER TABLE helixxi_companies
  ADD COLUMN IF NOT EXISTS integration_trust_score INTEGER DEFAULT 22,
  ADD COLUMN IF NOT EXISTS integration_events_total INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS integration_duplicate_events INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS integration_failures_24h INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS integration_last_event_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS integration_last_event_source TEXT,
  ADD COLUMN IF NOT EXISTS integration_last_event_status TEXT,
  ADD COLUMN IF NOT EXISTS integration_last_event_detail TEXT,
  ADD COLUMN IF NOT EXISTS integration_last_event_ip TEXT,
  ADD COLUMN IF NOT EXISTS integration_last_event_provider TEXT,
  ADD COLUMN IF NOT EXISTS integration_last_test_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS integration_last_test_status TEXT;

CREATE INDEX IF NOT EXISTS idx_helixxi_companies_integration_last_event_at
  ON helixxi_companies (integration_last_event_at);
