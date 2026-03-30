-- HELIXXI_FRAUDCONFIG
CREATE TABLE IF NOT EXISTS helixxi_fraudconfig (
  id BIGSERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ,
  weight_amount NUMERIC,
  weight_vendor NUMERIC,
  weight_duplicate NUMERIC,
  weight_timing NUMERIC,
  weight_round_number NUMERIC,
  weight_category NUMERIC,
  weight_intercompany NUMERIC,
  fp_rate NUMERIC,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HELIXXI_BASELINE
CREATE TABLE IF NOT EXISTS helixxi_baseline (
  id BIGSERIAL PRIMARY KEY,
  updated_at TIMESTAMPTZ,
  tx_count INTEGER,
  mean_amount NUMERIC,
  std_dev_amount NUMERIC,
  high_amount_line NUMERIC,
  known_vendors TEXT,
  known_vendor_count INTEGER,
  weekend_rate NUMERIC,
  round_rate NUMERIC,
  top_category TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HELIXXI_PERFORMANCE
CREATE TABLE IF NOT EXISTS helixxi_performance (
  id BIGSERIAL PRIMARY KEY,
  generated_at TIMESTAMPTZ,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  tx_count INTEGER,
  weekly_volume NUMERIC,
  avg_fraud_score NUMERIC,
  total_held INTEGER,
  false_positives INTEGER,
  true_positives INTEGER,
  false_positive_rate NUMERIC,
  fraud_precision NUMERIC,
  cat_accuracy NUMERIC,
  uncategorized_tx INTEGER,
  learned_vendors INTEGER,
  forecast_accuracy NUMERIC,
  health_signal TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add title column to ariajournal if missing
ALTER TABLE helixxi_ariajournal ADD COLUMN IF NOT EXISTS title TEXT;
