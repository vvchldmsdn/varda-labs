-- Daily KRW valuations share one fixing. Currency converted for an actual trade
-- remains a property of the transaction.
CREATE TABLE daily_valuation_fx (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date date NOT NULL,
  base_currency varchar(3) NOT NULL,
  quote_currency varchar(3) NOT NULL,
  reference_date date NOT NULL,
  rate numeric(20,6) NOT NULL,
  krw_per_eur numeric(20,8) NOT NULL,
  usd_per_eur numeric(20,8) NOT NULL,
  source text NOT NULL,
  policy text NOT NULL,
  evidence_kind text NOT NULL,
  fetched_at timestamptz NOT NULL,
  CONSTRAINT daily_valuation_fx_day_pair UNIQUE (service_date, base_currency, quote_currency),
  CONSTRAINT daily_valuation_fx_pair CHECK (base_currency='USD' AND quote_currency='KRW'),
  CONSTRAINT daily_valuation_fx_reference CHECK (reference_date BETWEEN service_date - 7 AND service_date - 1),
  CONSTRAINT daily_valuation_fx_cross CHECK (krw_per_eur>0 AND krw_per_eur<'Infinity'::numeric
    AND usd_per_eur>0 AND usd_per_eur<'Infinity'::numeric AND rate>0 AND rate=round(krw_per_eur/nullif(usd_per_eur,0),2)),
  CONSTRAINT daily_valuation_fx_source CHECK (source='ecb_eur_cross' AND policy='ecb-eur-cross-2dp-prev-market-day-v1'),
  CONSTRAINT daily_valuation_fx_kind CHECK (evidence_kind IN ('closing_reference','historical_reconstruction')),
  CONSTRAINT daily_valuation_fx_time CHECK (fetched_at >= (service_date + time '07:00') AT TIME ZONE 'Asia/Seoul')
);
--> statement-breakpoint
ALTER TABLE daily_valuation_fx ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON daily_valuation_fx FROM PUBLIC, varda_tenant_app;
--> statement-breakpoint
CREATE FUNCTION preserve_daily_valuation_fx() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'published daily valuation FX is immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER daily_valuation_fx_immutable BEFORE UPDATE OR DELETE ON daily_valuation_fx
FOR EACH ROW EXECUTE FUNCTION preserve_daily_valuation_fx();
