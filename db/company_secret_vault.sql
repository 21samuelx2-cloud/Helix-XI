-- Encrypted-at-rest tenant webhook secrets for provider-native verification.
-- Run this after the multi-tenant phase 1 migration.

ALTER TABLE helixxi_companies
  ADD COLUMN IF NOT EXISTS webhook_secret_ciphertext TEXT;
