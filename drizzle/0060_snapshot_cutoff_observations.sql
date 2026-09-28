-- Shared, bounded receipt evidence. Never tenant holdings, trades or a tick archive.
-- Cache replacement and receipt capture commit/rollback together.
CREATE TABLE snapshot_cutoff_price_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_date date NOT NULL,
 ticker varchar(50) NOT NULL, market varchar(20) NOT NULL, currency varchar(10) NOT NULL,
 provider varchar(100) NOT NULL, source varchar(100) NOT NULL, quote_type varchar(50) NOT NULL,
 price numeric(28,12) NOT NULL CHECK(price>0), observed_at timestamptz,
 fetched_at timestamptz NOT NULL, stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 timestamp_basis varchar(20) NOT NULL CHECK(timestamp_basis IN('provider','collection')),
 CHECK(observed_at IS NULL OR observed_at<=fetched_at),
 CHECK((timestamp_basis='collection' AND observed_at IS NULL) OR (timestamp_basis='provider' AND observed_at IS NOT NULL)),
 CHECK(snapshot_date=(fetched_at AT TIME ZONE 'Asia/Seoul')::date),
 CHECK((fetched_at AT TIME ZONE 'Asia/Seoul')::time BETWEEN TIME '06:45' AND TIME '07:00'),
 CONSTRAINT cutoff_price_receipt_unique UNIQUE(snapshot_date,market,ticker,currency,provider,fetched_at)
);
CREATE INDEX cutoff_price_retention_idx ON snapshot_cutoff_price_observations(snapshot_date);
CREATE TABLE snapshot_cutoff_fx_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot_date date NOT NULL,
 pair varchar(10) NOT NULL CHECK(pair='USD/KRW'), provider varchar(100) NOT NULL,
 source varchar(100) NOT NULL, rate_date date NOT NULL, usd_krw numeric(20,6) NOT NULL CHECK(usd_krw>0),
 observed_at timestamptz, rate_kind varchar(30), fetched_at timestamptz NOT NULL,
 stored_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 timestamp_basis varchar(20) NOT NULL CHECK(timestamp_basis IN('provider','collection')),
 CHECK(observed_at IS NULL OR observed_at<=fetched_at),
 CHECK((timestamp_basis='collection' AND observed_at IS NULL AND rate_kind IS NULL) OR (timestamp_basis='provider' AND observed_at IS NOT NULL AND rate_kind IN('spot','daily_reference'))),
 CHECK(snapshot_date=(fetched_at AT TIME ZONE 'Asia/Seoul')::date),
 CHECK((fetched_at AT TIME ZONE 'Asia/Seoul')::time BETWEEN TIME '06:45' AND TIME '07:00'),
 CONSTRAINT cutoff_fx_receipt_unique UNIQUE(snapshot_date,pair,provider,fetched_at)
);
CREATE INDEX cutoff_fx_retention_idx ON snapshot_cutoff_fx_observations(snapshot_date);
ALTER TABLE snapshot_cutoff_price_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_cutoff_price_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE snapshot_cutoff_fx_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE snapshot_cutoff_fx_observations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON snapshot_cutoff_price_observations,snapshot_cutoff_fx_observations FROM PUBLIC,varda_tenant_app;

CREATE FUNCTION snapshot_cutoff_receipt_date(p_fetched timestamptz) RETURNS date
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT CASE WHEN p_fetched<=statement_timestamp() AND p_fetched>=statement_timestamp()-INTERVAL '35 days'
 AND (p_fetched AT TIME ZONE 'Asia/Seoul')::time BETWEEN TIME '06:45' AND TIME '07:00'
 THEN (p_fetched AT TIME ZONE 'Asia/Seoul')::date ELSE NULL END
$$;
CREATE FUNCTION capture_snapshot_cutoff_price() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d date;
BEGIN
 d:=public.snapshot_cutoff_receipt_date(NEW.fetched_at);
 IF d IS NULL OR NEW.provider<>'kis' OR NEW.status<>'ok' OR NEW.price IS NULL OR NEW.price<=0
 OR NEW.quote_type NOT IN('live','delayed','realtime')
 OR (NEW.source<>'kis_domestic_inquire_price' AND NEW.source!~'^kis_overseas_price:[A-Z]+$') THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cairn.cutoff.price:'||d::text||':'||NEW.market||':'||NEW.ticker||':'||NEW.currency||':'||NEW.provider,0));
 -- KIS live endpoints do not expose a verified exchange observation timestamp.
 INSERT INTO public.snapshot_cutoff_price_observations(snapshot_date,ticker,market,currency,provider,source,quote_type,price,observed_at,fetched_at,timestamp_basis)
 VALUES(d,NEW.ticker,NEW.market,NEW.currency,NEW.provider,NEW.source,NEW.quote_type,NEW.price,NULL,NEW.fetched_at,'collection') ON CONFLICT DO NOTHING;
 DELETE FROM public.snapshot_cutoff_price_observations WHERE id IN (
 SELECT id FROM public.snapshot_cutoff_price_observations WHERE snapshot_date=d AND ticker=NEW.ticker AND market=NEW.market AND currency=NEW.currency AND provider=NEW.provider
 ORDER BY fetched_at DESC,id DESC OFFSET 32);
 DELETE FROM public.snapshot_cutoff_price_observations WHERE id IN (
 SELECT id FROM public.snapshot_cutoff_price_observations WHERE snapshot_date<=(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date-35 ORDER BY snapshot_date LIMIT 2048);
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_snapshot_cutoff_price AFTER INSERT OR UPDATE ON live_price_quotes FOR EACH ROW EXECUTE FUNCTION capture_snapshot_cutoff_price();

CREATE FUNCTION record_snapshot_cutoff_fx(p_source text,p_rate_date date,p_value numeric,p_observed timestamptz,p_kind text,p_fetched timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE d date; provider_name text; basis text;
BEGIN
 d:=public.snapshot_cutoff_receipt_date(p_fetched);
 provider_name:=CASE WHEN p_source~'^kis_overseas_price_detail:[A-Z]+$' THEN 'kis'
 WHEN p_source='er-api_open_access' THEN 'er-api-open' ELSE NULL END;
 IF d IS NULL OR provider_name IS NULL OR p_value IS NULL OR p_value<=0 OR p_rate_date>d THEN RETURN; END IF;
 IF provider_name='kis' THEN p_observed:=NULL; p_kind:=NULL; basis:='collection';
 ELSE
  IF p_observed IS NULL OR p_observed>p_fetched OR p_kind IS NULL OR p_kind NOT IN('spot','daily_reference') THEN RETURN; END IF;
  basis:='provider';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cairn.cutoff.fx:'||d::text||':'||provider_name,0));
 INSERT INTO public.snapshot_cutoff_fx_observations(snapshot_date,pair,provider,source,rate_date,usd_krw,observed_at,rate_kind,fetched_at,timestamp_basis)
 VALUES(d,'USD/KRW',provider_name,p_source,p_rate_date,p_value,p_observed,p_kind,p_fetched,basis) ON CONFLICT DO NOTHING;
 DELETE FROM public.snapshot_cutoff_fx_observations WHERE id IN (
 SELECT id FROM public.snapshot_cutoff_fx_observations WHERE snapshot_date=d AND pair='USD/KRW' AND provider=provider_name ORDER BY fetched_at DESC,id DESC OFFSET 32);
 DELETE FROM public.snapshot_cutoff_fx_observations WHERE id IN (
 SELECT id FROM public.snapshot_cutoff_fx_observations WHERE snapshot_date<=(statement_timestamp() AT TIME ZONE 'Asia/Seoul')::date-35 ORDER BY snapshot_date LIMIT 2048);
END $$;
CREATE FUNCTION capture_snapshot_cutoff_fx() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.status='ok' AND NOT NEW.is_sample THEN
  PERFORM public.record_snapshot_cutoff_fx(NEW.source,NEW.date,NEW.usdkrw,NEW.observed_at,NEW.rate_kind,NEW.fetched_at);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_snapshot_cutoff_fx AFTER INSERT OR UPDATE ON fx_rates FOR EACH ROW EXECUTE FUNCTION capture_snapshot_cutoff_fx();
CREATE FUNCTION reject_cutoff_observation_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'cutoff_observation_immutable'; END $$;
CREATE TRIGGER cutoff_price_immutable BEFORE UPDATE ON snapshot_cutoff_price_observations FOR EACH ROW EXECUTE FUNCTION reject_cutoff_observation_update();
CREATE TRIGGER cutoff_fx_immutable BEFORE UPDATE ON snapshot_cutoff_fx_observations FOR EACH ROW EXECUTE FUNCTION reject_cutoff_observation_update();
REVOKE ALL ON FUNCTION snapshot_cutoff_receipt_date(timestamptz),capture_snapshot_cutoff_price(),record_snapshot_cutoff_fx(text,date,numeric,timestamptz,text,timestamptz),capture_snapshot_cutoff_fx(),reject_cutoff_observation_update() FROM PUBLIC,varda_tenant_app;
