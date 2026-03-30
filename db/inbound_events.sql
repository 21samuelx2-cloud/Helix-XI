CREATE TABLE IF NOT EXISTS helixxi_inbound_events (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT UNIQUE NOT NULL,
  company_id UUID REFERENCES helixxi_companies(id) ON DELETE SET NULL,
  source TEXT NOT NULL,
  payload_hash TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_helixxi_inbound_events_company_id
  ON helixxi_inbound_events (company_id);

CREATE INDEX IF NOT EXISTS idx_helixxi_inbound_events_source
  ON helixxi_inbound_events (source);

CREATE INDEX IF NOT EXISTS idx_helixxi_inbound_events_expires_at
  ON helixxi_inbound_events (expires_at);
