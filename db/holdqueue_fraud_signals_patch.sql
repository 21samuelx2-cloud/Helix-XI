-- Optional schema patch for older Supabase projects.
-- This keeps fraud-signal detail available on held and posted transactions.

ALTER TABLE helixxi_holdqueue
  ADD COLUMN IF NOT EXISTS fraud_signals TEXT;

ALTER TABLE helixxi_ledger
  ADD COLUMN IF NOT EXISTS fraud_signals TEXT;
