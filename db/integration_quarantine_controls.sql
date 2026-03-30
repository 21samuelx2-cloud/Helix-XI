alter table if exists helixxi_companies
  add column if not exists integration_quarantined boolean default false;

alter table if exists helixxi_companies
  add column if not exists integration_quarantine_reason text;

alter table if exists helixxi_companies
  add column if not exists integration_quarantined_at timestamptz;

alter table if exists helixxi_companies
  add column if not exists integration_last_drift_at timestamptz;

alter table if exists helixxi_companies
  add column if not exists integration_last_drift_reason text;

alter table if exists helixxi_companies
  add column if not exists integration_drift_events integer default 0;
