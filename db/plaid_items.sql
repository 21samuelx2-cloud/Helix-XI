-- HELIXXI_PLAID_ITEMS
CREATE TABLE IF NOT EXISTS helixxi_plaid_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id UUID REFERENCES helixxi_companies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES helixxi_users(id) ON DELETE SET NULL,
  item_id TEXT UNIQUE NOT NULL,
  access_token_ciphertext TEXT NOT NULL,
  institution_id TEXT,
  institution_name TEXT,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS helixxi_plaid_items_company_idx
  ON helixxi_plaid_items (company_id);

CREATE INDEX IF NOT EXISTS helixxi_plaid_items_user_idx
  ON helixxi_plaid_items (user_id);
