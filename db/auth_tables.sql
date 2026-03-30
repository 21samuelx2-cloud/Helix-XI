-- HELIXXI_USERS
CREATE TABLE IF NOT EXISTS helixxi_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'INDIVIDUAL',
  status TEXT DEFAULT 'PENDING',
  account_type TEXT DEFAULT 'individual',
  company_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_login TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  approved_by TEXT
);

-- HELIXXI_COMPANIES
CREATE TABLE IF NOT EXISTS helixxi_companies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  company_name TEXT NOT NULL,
  domain TEXT UNIQUE NOT NULL,
  google_org_id TEXT,
  manager_email TEXT NOT NULL,
  status TEXT DEFAULT 'PENDING',
  plan TEXT DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT
);
