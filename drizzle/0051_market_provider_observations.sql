-- Licensed shared reference cache. No existing data or tenant authorization is changed.
CREATE TABLE market_provider_observations (
  observation_key varchar(64) PRIMARY KEY,
  scope_key varchar(64) NOT NULL,
  identity_key varchar(64) NOT NULL,
  provider varchar(20) NOT NULL,
  license_scope varchar(160) NOT NULL,
  audience varchar(24) NOT NULL,
  contract_version varchar(80) NOT NULL,
  dataset varchar(24) NOT NULL,
  instrument_key varchar(160),
  ticker varchar(32) NOT NULL,
  mic_code varchar(4),
  exchange varchar(80),
  instrument_type varchar(20),
  currency varchar(3) NOT NULL,
  quote_currency varchar(3),
  value numeric(38,18) NOT NULL,
  price_basis varchar(32) NOT NULL,
  adjustment varchar(20) NOT NULL,
  session varchar(20) NOT NULL,
  observed_at timestamptz,
  requested_at timestamptz,
  exchange_date date,
  fetched_at timestamptz NOT NULL,
  last_fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  source varchar(32) NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  status varchar(12) NOT NULL DEFAULT 'ok',
  CONSTRAINT market_provider_observations_source_check CHECK (
    provider='twelve_data' AND source='twelve_data' AND NOT synthetic AND value>0 AND
    audience IN ('internal_validation','member_display','public_demo') AND status IN ('ok','conflict') AND
    fetched_at<=last_fetched_at AND expires_at>fetched_at AND (observed_at IS NULL OR observed_at<=fetched_at)),
  CONSTRAINT market_provider_observations_basis_check CHECK (
    (dataset='us_quote' AND requested_at IS NULL AND currency='USD' AND quote_currency IS NULL AND instrument_key IS NOT NULL AND mic_code IS NOT NULL AND
      exchange IS NOT NULL AND instrument_type IN ('Common Stock','ETF') AND price_basis='provider_quote_close' AND adjustment='not_applicable' AND
      session='regular' AND observed_at IS NOT NULL AND exchange_date IS NULL) OR
    (dataset='us_daily_raw' AND requested_at IS NULL AND currency='USD' AND quote_currency IS NULL AND instrument_key IS NOT NULL AND mic_code IS NOT NULL AND
      exchange IS NOT NULL AND instrument_type IN ('Common Stock','ETF') AND price_basis='raw_close' AND adjustment='none' AND
      session='regular' AND observed_at IS NULL AND exchange_date IS NOT NULL) OR
    (dataset='usd_krw' AND requested_at IS NULL AND currency='USD' AND quote_currency='KRW' AND instrument_key IS NULL AND mic_code IS NULL AND
      exchange IS NULL AND instrument_type IS NULL AND price_basis='fx_rate' AND adjustment='not_applicable' AND session='not_applicable' AND
      observed_at IS NOT NULL AND exchange_date IS NULL) OR
    (dataset='usd_krw_history' AND currency='USD' AND quote_currency='KRW' AND instrument_key IS NULL AND mic_code IS NULL AND
      exchange IS NULL AND instrument_type IS NULL AND price_basis='fx_rate' AND adjustment='not_applicable' AND session='not_applicable' AND
      observed_at IS NOT NULL AND exchange_date IS NULL AND requested_at IS NOT NULL AND observed_at<=requested_at AND requested_at<=fetched_at))
);
--> statement-breakpoint
CREATE INDEX market_provider_observations_lookup_idx ON market_provider_observations(scope_key,identity_key,dataset,observed_at,exchange_date);
CREATE INDEX market_provider_observations_expiry_idx ON market_provider_observations(expires_at);
CREATE INDEX market_provider_observations_historical_fx_idx ON market_provider_observations(scope_key,identity_key,dataset,requested_at);
--> statement-breakpoint
CREATE TABLE market_provider_action_coverage (
  coverage_key varchar(64) PRIMARY KEY,
  scope_key varchar(64) NOT NULL,
  identity_key varchar(64) NOT NULL,
  instrument_key varchar(160) NOT NULL,
  ticker varchar(32) NOT NULL,
  mic_code varchar(4) NOT NULL,
  action_type varchar(12) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status varchar(12) NOT NULL,
  source varchar(32) NOT NULL,
  source_endpoint varchar(20),
  source_meaning varchar(40) NOT NULL,
  response_hash varchar(64),
  fetched_at timestamptz NOT NULL,
  last_fetched_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  synthetic boolean NOT NULL DEFAULT false,
  CONSTRAINT market_provider_action_coverage_check CHECK (
    action_type IN ('split','dividend') AND status IN ('unknown','complete','conflict') AND source='twelve_data' AND NOT synthetic AND
    start_date<=end_date AND end_date-start_date<90 AND fetched_at<=last_fetched_at AND expires_at>fetched_at AND
    ((status='unknown' AND source_endpoint IS NULL AND source_meaning='not_collected' AND response_hash IS NULL) OR
     (status IN ('complete','conflict') AND response_hash IS NOT NULL AND
       ((action_type='split' AND source_endpoint='/splits' AND source_meaning='provider_split_factors') OR
        (action_type='dividend' AND source_endpoint='/dividends' AND source_meaning='unadjusted_cash_per_share')))))
);
--> statement-breakpoint
CREATE INDEX market_provider_action_coverage_lookup_idx ON market_provider_action_coverage(scope_key,identity_key,action_type,start_date,end_date);
CREATE INDEX market_provider_action_coverage_expiry_idx ON market_provider_action_coverage(expires_at);
--> statement-breakpoint
CREATE TABLE market_provider_corporate_actions (
  action_key varchar(64) PRIMARY KEY,
  coverage_key varchar(64) NOT NULL REFERENCES market_provider_action_coverage(coverage_key) ON DELETE CASCADE,
  event_key varchar(64) NOT NULL,
  action_type varchar(12) NOT NULL,
  effective_date date NOT NULL,
  from_factor numeric(38,18),
  to_factor numeric(38,18),
  cash_amount numeric(38,18),
  currency varchar(3),
  fetched_at timestamptz NOT NULL,
  CONSTRAINT market_provider_corporate_actions_values_check CHECK (
    (action_type='split' AND from_factor IS NOT NULL AND to_factor IS NOT NULL AND from_factor>0 AND to_factor>0 AND cash_amount IS NULL AND currency IS NULL) OR
    (action_type='dividend' AND from_factor IS NULL AND to_factor IS NULL AND cash_amount IS NOT NULL AND cash_amount>0 AND currency IS NOT NULL AND currency='USD'))
);
--> statement-breakpoint
CREATE INDEX market_provider_corporate_actions_coverage_idx ON market_provider_corporate_actions(coverage_key,effective_date);
--> statement-breakpoint
ALTER TABLE market_provider_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_provider_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE market_provider_action_coverage ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_provider_action_coverage FORCE ROW LEVEL SECURITY;
ALTER TABLE market_provider_corporate_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_provider_corporate_actions FORCE ROW LEVEL SECURITY;
REVOKE ALL ON market_provider_observations,market_provider_action_coverage,market_provider_corporate_actions FROM PUBLIC,varda_tenant_app;
