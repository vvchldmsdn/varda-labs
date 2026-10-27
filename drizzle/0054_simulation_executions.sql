-- Private short-lived computation artifacts; no financial records or backfill.
CREATE TABLE public.simulation_executions (
 owner_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
 id uuid NOT NULL,
 binding text NOT NULL CHECK(binding ~ '^[a-f0-9]{64}$'),
 codec text NOT NULL CHECK(length(codec)<=80),
 projection integer NOT NULL,
 model text NOT NULL CHECK(model IN ('economic','bootstrap')),
 currency text NOT NULL CHECK(currency IN ('KRW','USD')),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=131072),
 common_data bytea NOT NULL CHECK(octet_length(common_data)<=2098176),
 reserved_bytes bigint NOT NULL CHECK(reserved_bytes BETWEEN 1 AND 100663296),
 state text NOT NULL DEFAULT 'creating' CHECK(state IN ('creating','ready','failed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '6 hours',
 PRIMARY KEY(owner_user_id,id)
);
--> statement-breakpoint
CREATE TABLE public.simulation_execution_chunks (
 owner_user_id uuid NOT NULL,
 execution_id uuid NOT NULL,
 chunk_index integer NOT NULL CHECK(chunk_index BETWEEN 0 AND 124),
 manifest jsonb NOT NULL CHECK(octet_length(manifest::text)<=1024),
 data bytea NOT NULL CHECK(octet_length(data)<=615424),
 PRIMARY KEY(owner_user_id,execution_id,chunk_index),
 FOREIGN KEY(owner_user_id,execution_id) REFERENCES public.simulation_executions(owner_user_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX simulation_executions_expiry ON public.simulation_executions(expires_at);
CREATE UNIQUE INDEX simulation_executions_owner_binding ON public.simulation_executions(owner_user_id,binding);
CREATE INDEX simulation_executions_incomplete ON public.simulation_executions(created_at) WHERE state<>'ready';
--> statement-breakpoint
ALTER TABLE public.simulation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_executions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_execution_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulation_execution_chunks FORCE ROW LEVEL SECURITY;
CREATE POLICY simulation_executions_owner ON public.simulation_executions TO varda_tenant_app USING(owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active()) WITH CHECK(owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active());
CREATE POLICY simulation_chunks_owner ON public.simulation_execution_chunks TO varda_tenant_app USING(owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active()) WITH CHECK(owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.simulation_executions TO varda_tenant_app;
GRANT SELECT,INSERT ON public.simulation_execution_chunks TO varda_tenant_app;
--> statement-breakpoint
CREATE FUNCTION public.simulation_execution_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('cairn.simulation.execution.v1:'||NEW.owner_user_id::text,0));
  IF (SELECT count(*) FROM public.simulation_executions WHERE owner_user_id=NEW.owner_user_id)>=2 OR (SELECT coalesce(sum(reserved_bytes),0) FROM public.simulation_executions WHERE owner_user_id=NEW.owner_user_id)+NEW.reserved_bytes>201326592 OR EXISTS(SELECT 1 FROM public.simulation_executions WHERE owner_user_id=NEW.owner_user_id AND state='creating') THEN RAISE EXCEPTION 'execution_limit'; END IF;
  -- Writers take the owner lock in a preceding statement for a fresh READ COMMITTED snapshot.
  IF NEW.state<>'creating' OR NEW.completed_at IS NOT NULL OR NEW.codec<>'path-f64le-gzip-v1' OR NEW.projection<>1 THEN RAISE EXCEPTION 'execution_invalid'; END IF;
  NEW.created_at=clock_timestamp(); NEW.expires_at=NEW.created_at+interval '6 hours';
  IF jsonb_array_length(NEW.manifest->'chunks') NOT BETWEEN 1 AND 125 OR (NEW.manifest->>'pathCount')::int NOT BETWEEN 1 AND 1000 OR (NEW.manifest->>'horizon')::int NOT BETWEEN 1 AND 126 OR (NEW.manifest->>'assets')::int NOT BETWEEN 1 AND 64 OR (NEW.manifest->>'factors')::int NOT BETWEEN 0 AND 3 OR (NEW.manifest->>'bytes')::bigint<>NEW.reserved_bytes THEN RAISE EXCEPTION 'execution_invalid'; END IF;
  IF octet_length(NEW.common_data)<>(NEW.manifest->'common'->>'bytes')::int OR encode(sha256(NEW.common_data),'hex')<>NEW.manifest->'common'->>'compressedHash' THEN RAISE EXCEPTION 'execution_corrupt'; END IF;
 ELSE
  IF (to_jsonb(NEW)-'state'-'completed_at') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'completed_at') OR OLD.state<>'creating' OR NEW.state NOT IN ('ready','failed') OR OLD.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'execution_immutable'; END IF;
  IF NEW.state='ready' THEN
   IF (SELECT count(*) FROM public.simulation_execution_chunks c WHERE c.owner_user_id=NEW.owner_user_id AND c.execution_id=NEW.id)<>jsonb_array_length(NEW.manifest->'chunks') OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.manifest->'chunks') WITH ORDINALITY m(value,ordinal) WHERE NOT EXISTS(SELECT 1 FROM public.simulation_execution_chunks c WHERE c.owner_user_id=NEW.owner_user_id AND c.execution_id=NEW.id AND c.chunk_index=m.ordinal-1 AND c.manifest=m.value AND octet_length(c.data)=(m.value->>'bytes')::int AND encode(sha256(c.data),'hex')=m.value->>'compressedHash')) THEN RAISE EXCEPTION 'execution_incomplete'; END IF;
   IF NEW.reserved_bytes<>octet_length(NEW.common_data)+(SELECT sum(octet_length(data)) FROM public.simulation_execution_chunks WHERE owner_user_id=NEW.owner_user_id AND execution_id=NEW.id) THEN RAISE EXCEPTION 'execution_size'; END IF;
   NEW.completed_at=clock_timestamp();
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER simulation_execution_immutable BEFORE INSERT OR UPDATE ON public.simulation_executions FOR EACH ROW EXECUTE FUNCTION public.simulation_execution_guard();
--> statement-breakpoint
CREATE FUNCTION public.simulation_chunk_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.simulation_executions e WHERE e.owner_user_id=NEW.owner_user_id AND e.id=NEW.execution_id AND e.state='creating' AND e.expires_at>clock_timestamp() AND e.manifest->'chunks'->NEW.chunk_index=NEW.manifest) OR octet_length(NEW.data)<>(NEW.manifest->>'bytes')::int OR encode(sha256(NEW.data),'hex')<>NEW.manifest->>'compressedHash' THEN RAISE EXCEPTION 'execution_chunk_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER simulation_chunk_immutable BEFORE INSERT ON public.simulation_execution_chunks FOR EACH ROW EXECUTE FUNCTION public.simulation_chunk_guard();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.simulation_execution_guard(),public.simulation_chunk_guard() FROM PUBLIC;
-- Expiry cleanup is invoked only via a server-authenticated job, never tenant SQL.
-- No scheduler, cron, or production environment change is included here.
