-- Additive, public reference only. No tenant/portfolio data is read or changed.
CREATE TABLE IF NOT EXISTS instrument_catalog (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 isin varchar(12) NOT NULL,
 ticker varchar(50) NOT NULL,
 name text NOT NULL,
 market varchar(20) NOT NULL,
 exchange varchar(20) NOT NULL,
 currency varchar(10) NOT NULL,
 asset_type varchar(10) NOT NULL,
 security_group varchar(2) NOT NULL,
 source text NOT NULL,
 source_sha256 varchar(64) NOT NULL,
 verified_at timestamptz NOT NULL,
 is_active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT instrument_catalog_supported CHECK (
  market='korea' AND currency='KRW' AND exchange IN ('KOSPI','KOSDAQ')
  AND ((asset_type='stock' AND security_group='ST') OR (asset_type='etf' AND security_group='EF'))
 )
);
CREATE UNIQUE INDEX IF NOT EXISTS instrument_catalog_isin_unique ON instrument_catalog(isin);
CREATE UNIQUE INDEX IF NOT EXISTS instrument_catalog_active_identity_unique ON instrument_catalog(market,currency,ticker) WHERE is_active=true;
CREATE INDEX IF NOT EXISTS instrument_catalog_name_idx ON instrument_catalog(name);
REVOKE ALL ON TABLE instrument_catalog FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='varda_tenant_app') THEN
  GRANT SELECT ON TABLE instrument_catalog TO varda_tenant_app;
 END IF;
END $$;
