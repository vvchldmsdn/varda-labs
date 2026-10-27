-- Two completed executions plus one bounded in-flight upload per owner.
-- Byte budget, global admission, expiry, immutable content and RLS stay unchanged.
-- Old application writers remain compatible but cannot use the third staging slot.
CREATE OR REPLACE FUNCTION public.simulation_execution_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('cairn.simulation.execution.v1:'||NEW.owner_user_id::text,0));
 IF TG_OP='INSERT' THEN
  IF (SELECT count(*) FROM public.simulation_executions WHERE owner_user_id=NEW.owner_user_id)>=3 OR (SELECT coalesce(sum(reserved_bytes),0) FROM public.simulation_executions WHERE owner_user_id=NEW.owner_user_id)+NEW.reserved_bytes>201326592 OR EXISTS(SELECT 1 FROM public.simulation_executions WHERE owner_user_id=NEW.owner_user_id AND state='creating') THEN RAISE EXCEPTION 'execution_limit'; END IF;
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
   -- Keep both completed runs until all new chunks have passed validation.
   -- DELETE and the ready transition commit together; any failure restores both.
   DELETE FROM public.simulation_executions WHERE owner_user_id=NEW.owner_user_id AND id IN (
    SELECT id FROM public.simulation_executions WHERE owner_user_id=NEW.owner_user_id AND state='ready' AND id<>NEW.id
    ORDER BY created_at DESC,id DESC OFFSET 1
   );
   NEW.completed_at=clock_timestamp();
  END IF;
 END IF;
 RETURN NEW;
END $$;
