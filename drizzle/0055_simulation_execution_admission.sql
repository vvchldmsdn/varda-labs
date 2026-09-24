-- Closed by default. Configure only after measured plan capacity and cleanup verification.
CREATE TABLE public.simulation_execution_service (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 enabled boolean NOT NULL DEFAULT false,
 qa_only boolean NOT NULL DEFAULT true,
 qa_owners uuid[] NOT NULL DEFAULT '{}',
 max_bytes bigint NOT NULL DEFAULT 134217728 CHECK(max_bytes BETWEEN 1048576 AND 536870912),
 max_count integer NOT NULL DEFAULT 8 CHECK(max_count BETWEEN 1 AND 128),
 max_creating integer NOT NULL DEFAULT 1 CHECK(max_creating BETWEEN 1 AND 4),
 max_hourly integer NOT NULL DEFAULT 4 CHECK(max_hourly BETWEEN 1 AND 100),
 owner_interval_seconds integer NOT NULL DEFAULT 60 CHECK(owner_interval_seconds BETWEEN 0 AND 86400),
 cleanup_max_age_seconds integer NOT NULL DEFAULT 93600 CHECK(cleanup_max_age_seconds BETWEEN 60 AND 93600),
 backlog_max_age_seconds integer NOT NULL DEFAULT 93600 CHECK(backlog_max_age_seconds BETWEEN 60 AND 93600),
 used_bytes bigint NOT NULL DEFAULT 0 CHECK(used_bytes>=0),
 retained integer NOT NULL DEFAULT 0 CHECK(retained>=0),
 creating integer NOT NULL DEFAULT 0 CHECK(creating>=0),
 hour_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 hourly integer NOT NULL DEFAULT 0 CHECK(hourly>=0),
 cleanup_lease uuid,
 cleanup_lease_until timestamptz,
 cleanup_started_at timestamptz,
 cleanup_succeeded_at timestamptz,
 cleanup_failed_at timestamptz,
 cleanup_removed integer NOT NULL DEFAULT 0,
 cleanup_backlog integer NOT NULL DEFAULT 0,
 cleanup_oldest_expired_at timestamptz
);
INSERT INTO public.simulation_execution_service(id,used_bytes,retained,creating)
 SELECT true,coalesce(sum(reserved_bytes),0),count(*),count(*) FILTER(WHERE state='creating') FROM public.simulation_executions;
CREATE TABLE public.simulation_execution_frequency (
 owner_user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
 last_admitted_at timestamptz NOT NULL
);
REVOKE ALL ON public.simulation_execution_service,public.simulation_execution_frequency FROM PUBLIC,varda_tenant_app;
ALTER TABLE public.simulation_execution_frequency ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_execution_frequency FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Deliberately returns only admission, never global usage or another owner's data.
CREATE FUNCTION public.simulation_execution_admission() RETURNS boolean LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT coalesce((SELECT enabled AND (NOT qa_only OR nullif(current_setting('app.current_user_id',true),'')::uuid=ANY(qa_owners))
 AND public.investment_plan_tenant_active()
 AND used_bytes<max_bytes AND retained<max_count AND creating<max_creating
 AND (hour_started_at<=clock_timestamp()-interval '1 hour' OR hourly<max_hourly)
 AND cleanup_succeeded_at>clock_timestamp()-make_interval(secs=>cleanup_max_age_seconds)
 AND NOT EXISTS(SELECT 1 FROM public.simulation_executions WHERE expires_at<clock_timestamp()-make_interval(secs=>backlog_max_age_seconds))
 AND NOT EXISTS(SELECT 1 FROM public.simulation_execution_frequency WHERE owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND last_admitted_at>clock_timestamp()-make_interval(secs=>owner_interval_seconds))
 FROM public.simulation_execution_service WHERE id),false)
$$;
REVOKE ALL ON FUNCTION public.simulation_execution_admission() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_execution_admission() TO varda_tenant_app;
--> statement-breakpoint
-- A single locked row serializes reservations across ALL owners and survives deletes.
-- This function can run only as a trigger on the two private execution tables.
CREATE FUNCTION public.simulation_execution_budget_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p public.simulation_execution_service%ROWTYPE; admitted timestamptz;
BEGIN
 SELECT * INTO STRICT p FROM public.simulation_execution_service WHERE id FOR UPDATE;
 IF TG_OP='INSERT' THEN
  IF NEW.owner_user_id IS DISTINCT FROM nullif(current_setting('app.current_user_id',true),'')::uuid OR NOT public.investment_plan_tenant_active() THEN RAISE EXCEPTION 'execution_owner_invalid'; END IF;
  IF NOT public.simulation_execution_admission() OR p.used_bytes+NEW.reserved_bytes>p.max_bytes THEN RAISE EXCEPTION 'execution_service_limit'; END IF;
  admitted=clock_timestamp();
  INSERT INTO public.simulation_execution_frequency(owner_user_id,last_admitted_at) VALUES(NEW.owner_user_id,admitted)
   ON CONFLICT(owner_user_id) DO UPDATE SET last_admitted_at=excluded.last_admitted_at;
  UPDATE public.simulation_execution_service SET used_bytes=used_bytes+NEW.reserved_bytes,retained=retained+1,creating=creating+1,
   hourly=CASE WHEN hour_started_at<=admitted-interval '1 hour' THEN 1 ELSE hourly+1 END,
   hour_started_at=CASE WHEN hour_started_at<=admitted-interval '1 hour' THEN admitted ELSE hour_started_at END WHERE id;
 ELSIF TG_OP='DELETE' THEN
  UPDATE public.simulation_execution_service SET used_bytes=used_bytes-OLD.reserved_bytes,retained=retained-1,creating=creating-CASE WHEN OLD.state='creating' THEN 1 ELSE 0 END WHERE id;
 ELSE
  UPDATE public.simulation_execution_service SET creating=creating+(CASE WHEN NEW.state='creating' THEN 1 ELSE 0 END)-(CASE WHEN OLD.state='creating' THEN 1 ELSE 0 END) WHERE id;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.simulation_execution_budget_guard() FROM PUBLIC;
CREATE TRIGGER simulation_execution_budget AFTER INSERT OR UPDATE OR DELETE ON public.simulation_executions FOR EACH ROW EXECUTE FUNCTION public.simulation_execution_budget_guard();
--> statement-breakpoint
-- Positive predicates reject absent JSON keys instead of letting SQL NULL pass.
CREATE FUNCTION public.simulation_execution_manifest_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
DECLARE m jsonb; i integer=0; paths integer; h integer; a integer; f integer; raw_total bigint;
BEGIN
 m=NEW.manifest;
 IF (jsonb_typeof(m)='object' AND m ?& ARRAY['id','binding','model','currency','pathCount','horizon','assets','factors','bytes','rawBytes','common','chunks']
 AND m->>'id'=NEW.id::text AND m->>'binding'=NEW.binding AND m->>'model'=NEW.model AND m->>'currency'=NEW.currency
 AND jsonb_typeof(m->'chunks')='array' AND jsonb_typeof(m->'common')='object') IS NOT TRUE THEN RAISE EXCEPTION 'execution_invalid'; END IF;
 paths=(m->>'pathCount')::int; h=(m->>'horizon')::int; a=(m->>'assets')::int; f=(m->>'factors')::int;
 IF (paths BETWEEN 1 AND 1000 AND h BETWEEN 1 AND 126 AND a BETWEEN 1 AND 64 AND f BETWEEN 0 AND 3
 AND (NEW.model<>'bootstrap' OR f=0) AND jsonb_array_length(m->'chunks')=(paths+7)/8
 AND (m->>'bytes')::bigint=NEW.reserved_bytes AND (m->'common'->>'index')::int=-1
 AND (m->'common'->>'count')::int=paths AND (m->'common'->>'first')::int=0
 AND (m->'common'->>'rawBytes')::int BETWEEN 1 AND 2097152
 AND (m->'common'->>'bytes')::int=octet_length(NEW.common_data)
 AND m->'common'->>'checksum' ~ '^[a-f0-9]{64}$'
 AND m->'common'->>'compressedHash'=encode(sha256(NEW.common_data),'hex')) IS NOT TRUE THEN RAISE EXCEPTION 'execution_invalid'; END IF;
 raw_total=(m->'common'->>'rawBytes')::bigint;
 FOR m IN SELECT value FROM jsonb_array_elements(NEW.manifest->'chunks') LOOP
  IF (m ?& ARRAY['index','first','count','rawBytes','bytes','checksum','compressedHash']
   AND (m->>'index')::int=i AND (m->>'first')::int=i*8 AND (m->>'count')::int=least(8,paths-i*8)
   AND (m->>'rawBytes')::bigint=least(8,paths-i*8)*(h+1)*((a+f+1)*8+CASE WHEN NEW.model='bootstrap' THEN 5 ELSE 0 END)
   AND (m->>'rawBytes')::int BETWEEN 1 AND 614400 AND (m->>'bytes')::int BETWEEN 1 AND 615424
   AND m->>'checksum' ~ '^[a-f0-9]{64}$' AND m->>'compressedHash' ~ '^[a-f0-9]{64}$') IS NOT TRUE THEN RAISE EXCEPTION 'execution_invalid'; END IF;
  raw_total=raw_total+(m->>'rawBytes')::bigint; i=i+1;
 END LOOP;
 IF raw_total IS DISTINCT FROM (NEW.manifest->>'rawBytes')::bigint THEN RAISE EXCEPTION 'execution_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER simulation_execution_manifest BEFORE INSERT ON public.simulation_executions FOR EACH ROW EXECUTE FUNCTION public.simulation_execution_manifest_guard();
REVOKE ALL ON FUNCTION public.simulation_execution_manifest_guard() FROM PUBLIC;
