-- Immutable replay revisions. Original events and valuation observations stay intact.
CREATE TABLE native_ledger_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_owner_user_id uuid NOT NULL REFERENCES app_users(id),
 account_id uuid NOT NULL REFERENCES accounts(id), operation_id uuid NOT NULL, marker_sequence integer NOT NULL,
 affected_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL,
 effective_entries jsonb NOT NULL,
 CONSTRAINT native_revision_owner_account_marker_unique UNIQUE(canonical_owner_user_id,account_id,marker_sequence),
 CHECK(length(reason) BETWEEN 1 AND 300), CHECK(jsonb_typeof(effective_entries)='array' AND jsonb_array_length(effective_entries) BETWEEN 2 AND 501 AND octet_length(effective_entries::text)<=8000000)
);
ALTER TABLE native_ledger_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_ledger_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY native_revision_owner ON native_ledger_revisions FOR SELECT TO varda_tenant_app
 USING(canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND investment_plan_tenant_active());
GRANT SELECT ON native_ledger_revisions TO varda_tenant_app;
CREATE VIEW effective_native_ledger_entries WITH (security_invoker=true) AS
 WITH latest AS (SELECT DISTINCT ON(canonical_owner_user_id,account_id) * FROM native_ledger_revisions ORDER BY canonical_owner_user_id,account_id,marker_sequence DESC)
 SELECT e.id,e.canonical_owner_user_id,e.account_id,e.native_operation_id,e.native_sequence,e.native_data,e.recorded_at
 FROM event_ledger_entries e LEFT JOIN latest r ON r.canonical_owner_user_id=e.canonical_owner_user_id AND r.account_id=e.account_id
 WHERE e.native_data IS NOT NULL AND (r.id IS NULL OR e.native_sequence>r.marker_sequence)
 UNION ALL
 SELECT (v->>'id')::uuid,r.canonical_owner_user_id,r.account_id,(v->>'operationId')::uuid,(v->'data'->'state'->>'sequence')::integer,v->'data',r.recorded_at
 FROM latest r CROSS JOIN LATERAL jsonb_array_elements(r.effective_entries) v;
GRANT SELECT ON effective_native_ledger_entries TO varda_tenant_app;

-- An uncertain request can be retired without allowing its delayed copy to write.
-- No financial payload is retained here; a committed trade can never be cancelled.
CREATE TABLE native_operation_cancellations (
 canonical_owner_user_id uuid NOT NULL REFERENCES app_users(id), operation_id uuid NOT NULL,
 cancelled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(canonical_owner_user_id,operation_id)
);
ALTER TABLE native_operation_cancellations ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_operation_cancellations FORCE ROW LEVEL SECURITY;
CREATE POLICY native_cancellation_owner ON native_operation_cancellations FOR SELECT TO varda_tenant_app
 USING(canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND investment_plan_tenant_active());
GRANT SELECT ON native_operation_cancellations TO varda_tenant_app;
CREATE FUNCTION cancel_native_operation(p_owner uuid,p_operation uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_owner IS DISTINCT FROM nullif(current_setting('app.current_user_id',true),'')::uuid OR NOT public.investment_plan_tenant_active() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native_owner_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('varda.portfolio_mutation.v1:'||p_owner::text,0));
 IF EXISTS(SELECT 1 FROM public.event_ledger_entries WHERE canonical_owner_user_id=p_owner AND native_operation_id=p_operation) THEN RETURN 'committed'; END IF;
 INSERT INTO public.native_operation_cancellations(canonical_owner_user_id,operation_id) VALUES(p_owner,p_operation) ON CONFLICT DO NOTHING;
 RETURN 'cancelled';
END $$;
REVOKE ALL ON FUNCTION cancel_native_operation(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_native_operation(uuid,uuid) TO varda_tenant_app;
ALTER FUNCTION apply_native_portfolio_tenant_mutation(uuid,uuid,jsonb,jsonb) RENAME TO apply_native_portfolio_tenant_mutation_before_0059;
REVOKE ALL ON FUNCTION apply_native_portfolio_tenant_mutation_before_0059(uuid,uuid,jsonb,jsonb) FROM PUBLIC,varda_tenant_app;
CREATE FUNCTION apply_native_portfolio_tenant_mutation(p_owner uuid,p_operation uuid,p_request jsonb,p_changes jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_owner IS DISTINCT FROM nullif(current_setting('app.current_user_id',true),'')::uuid OR NOT public.investment_plan_tenant_active() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native_owner_invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('varda.portfolio_mutation.v1:'||p_owner::text,0));
 IF EXISTS(SELECT 1 FROM public.native_operation_cancellations WHERE canonical_owner_user_id=p_owner AND operation_id=p_operation) THEN RETURN 'operation_cancelled'; END IF;
 RETURN public.apply_native_portfolio_tenant_mutation_before_0059(p_owner,p_operation,p_request,p_changes);
END $$;
REVOKE ALL ON FUNCTION apply_native_portfolio_tenant_mutation(uuid,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_native_portfolio_tenant_mutation(uuid,uuid,jsonb,jsonb) TO varda_tenant_app;

CREATE FUNCTION apply_native_trade_revision(p_owner uuid,p_operation uuid,p_request jsonb,p_changes jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; a public.accounts%ROWTYPE; existing jsonb; actual jsonb; pos jsonb; n jsonb;
BEGIN
 IF p_owner IS DISTINCT FROM nullif(current_setting('app.current_user_id',true),'')::uuid OR NOT public.investment_plan_tenant_active() THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native_owner_invalid'; END IF;
 IF (jsonb_typeof(p_changes)='array' AND jsonb_array_length(p_changes) BETWEEN 1 AND 8 AND octet_length(p_changes::text)<=16000000) IS NOT TRUE THEN RAISE EXCEPTION 'native_invalid_changes'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('varda.portfolio_mutation.v1:'||p_owner::text,0));
 IF EXISTS(SELECT 1 FROM public.native_operation_cancellations WHERE canonical_owner_user_id=p_owner AND operation_id=p_operation) THEN RETURN 'operation_cancelled'; END IF;
 SELECT native_data->'request' INTO existing FROM public.event_ledger_entries WHERE canonical_owner_user_id=p_owner AND native_operation_id=p_operation LIMIT 1;
 IF FOUND THEN RETURN CASE WHEN existing=p_request THEN 'existing' ELSE 'conflict' END; END IF;
 IF (p_request->'history'->>'notInOpening')::boolean IS DISTINCT FROM true OR p_request->'event'->>'type' NOT IN ('buy','sell') THEN RAISE EXCEPTION 'native_history_invalid'; END IF;
 IF (SELECT count(DISTINCT owned.id) FROM jsonb_array_elements(p_changes) x JOIN public.accounts owned ON owned.id=(x->>'accountId')::uuid WHERE owned.canonical_owner_user_id=p_owner AND owned.is_active)<>jsonb_array_length(p_changes) THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native_owner_invalid'; END IF;
 PERFORM 1 FROM public.accounts WHERE id IN(SELECT (value->>'accountId')::uuid FROM jsonb_array_elements(p_changes)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.assets WHERE account_id IN(SELECT (value->>'accountId')::uuid FROM jsonb_array_elements(p_changes)) ORDER BY id FOR UPDATE;
 FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  SELECT * INTO a FROM public.accounts WHERE id=(c->>'accountId')::uuid AND canonical_owner_user_id=p_owner;
  IF a.native_state IS NULL OR a.native_state<>c->'expectedState' THEN RETURN 'conflict'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'quantity',quantity::text,'currency',currency,'archived',archived_at IS NOT NULL,'name',name,'ticker',ticker,'market',market,'assetType',asset_type) ORDER BY id),'[]'::jsonb) INTO actual FROM public.assets WHERE account_id=a.id AND canonical_owner_user_id=p_owner;
  IF actual<>c->'expectedAssets' THEN RETURN 'conflict'; END IF;
  n:=c->'next';
  IF (n->>'sequence')::integer<>(a.native_state->>'sequence')::integer+1 OR n->>'startedAt'<>a.native_state->>'startedAt' OR n->>'accountId'<>a.id::text THEN RAISE EXCEPTION 'native_revision_invalid'; END IF;
  IF (c->'effective'->0->'data'->'event'->>'type') IS DISTINCT FROM 'opening' OR c->'effective'->0->'data'->'state'->>'startedAt'<>a.native_state->>'startedAt' THEN RAISE EXCEPTION 'native_opening_invalid'; END IF;
  -- All positions, including a corrected first buy, must use existing owned assets.
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(n->'positions') p WHERE NOT EXISTS(SELECT 1 FROM public.assets h WHERE h.id=(p->>'assetId')::uuid AND h.account_id=a.id AND h.canonical_owner_user_id=p_owner AND h.currency=p->>'currency')) THEN RAISE EXCEPTION 'native_asset_scope_mismatch'; END IF;
 END LOOP;
 FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  SELECT * INTO a FROM public.accounts WHERE id=(c->>'accountId')::uuid AND canonical_owner_user_id=p_owner;
  n:=c->'next';
  -- Assets removed from the effective history become archived zero holdings.
  UPDATE public.assets h SET quantity=coalesce((SELECT (p->>'quantity')::numeric FROM jsonb_array_elements(n->'positions') p WHERE p->>'assetId'=h.id::text),0),
   archived_at=CASE WHEN coalesce((SELECT (p->>'quantity')::numeric FROM jsonb_array_elements(n->'positions') p WHERE p->>'assetId'=h.id::text),0)=0 THEN coalesce(h.archived_at,now()) ELSE NULL END,updated_at=now()
   WHERE h.account_id=a.id AND h.canonical_owner_user_id=p_owner;
  UPDATE public.accounts SET native_state=n,updated_at=now() WHERE id=a.id AND canonical_owner_user_id=p_owner;
  INSERT INTO public.native_ledger_revisions(canonical_owner_user_id,account_id,operation_id,marker_sequence,affected_at,reason,effective_entries)
   VALUES(p_owner,a.id,p_operation,(n->>'sequence')::integer,(c->>'affectedAt')::timestamptz,p_request->'history'->>'reason',c->'effective');
  -- Preserve invalidated observations and enqueue their dates in the same commit.
  -- The reader stops exposing them immediately; bounded workers rebuild later.
  INSERT INTO public.daily_snapshot_work(canonical_owner_user_id,account_id,snapshot_date,stage,revision)
   SELECT DISTINCT p_owner,a.id,s.snapshot_date,'native',(n->>'sequence')::integer
   FROM public.daily_portfolio_snapshots s
   WHERE s.account_id=a.id AND s.canonical_owner_user_id=p_owner AND s.native_evidence IS NOT NULL
    AND ((s.native_evidence->'frame'->>'at')::timestamptz>(c->>'affectedAt')::timestamptz
      OR ((s.native_evidence->'frame'->>'at')::timestamptz=(c->>'affectedAt')::timestamptz AND coalesce(s.native_evidence->'frame'->>'boundary','inclusive')<>'before'))
   ON CONFLICT DO NOTHING;
  INSERT INTO public.event_ledger_entries(canonical_owner_user_id,event_date,event_type,source,recorded_at,rule_version,account,account_id,asset_name,before_value,after_value,native_sequence,native_operation_id,native_data)
   VALUES(p_owner,(now() AT TIME ZONE 'Asia/Seoul')::date,'native_revision','native_ledger_v1',now(),'native_revision_v1',a.code,a.id,a.name,a.native_state::text,n::text,(n->>'sequence')::integer,p_operation,jsonb_build_object('request',p_request,'event',jsonb_build_object('type','revision','at',now(),'affectedAt',c->>'affectedAt'),'effect',null,'state',n));
 END LOOP;
 SET CONSTRAINTS public.native_asset_lifecycle_guard,public.native_account_lifecycle_guard IMMEDIATE;
 SET CONSTRAINTS public.native_asset_lifecycle_guard,public.native_account_lifecycle_guard DEFERRED;
 RETURN 'created';
END $$;
REVOKE ALL ON FUNCTION apply_native_trade_revision(uuid,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_native_trade_revision(uuid,uuid,jsonb,jsonb) TO varda_tenant_app;

ALTER TABLE daily_portfolio_snapshots DROP CONSTRAINT snapshot_native_evidence_check;
ALTER TABLE daily_portfolio_snapshots ADD CONSTRAINT snapshot_native_evidence_check CHECK(native_evidence IS NULL OR ((source IN('native_ledger_v1','native_ledger_cutoff_v2') OR source ~ '^native_ledger_cutoff_v3:r[0-9]+$') AND NOT is_sample AND octet_length(native_evidence::text)<=2000000));

-- Durable account/cutoff work. Access is server-only, never a tenant privilege.
CREATE TABLE daily_snapshot_work (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_owner_user_id uuid NOT NULL REFERENCES app_users(id), account_id uuid NOT NULL REFERENCES accounts(id),
 snapshot_date date NOT NULL, stage text NOT NULL CHECK(stage IN('legacy','native')), revision integer NOT NULL DEFAULT 0,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','running','completed','blocked','failed')),
 attempts integer NOT NULL DEFAULT 0, generation integer NOT NULL DEFAULT 0, lease_until timestamptz, next_attempt_at timestamptz,
 started_at timestamptz, finished_at timestamptz, reason text, updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT daily_snapshot_work_cutoff_unique UNIQUE(account_id,snapshot_date,stage,revision)
);
ALTER TABLE daily_snapshot_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_snapshot_work FORCE ROW LEVEL SECURITY;
REVOKE ALL ON daily_snapshot_work FROM PUBLIC,varda_tenant_app;
CREATE INDEX daily_snapshot_work_due ON daily_snapshot_work(status,next_attempt_at,snapshot_date);
CREATE FUNCTION assert_daily_snapshot_fence(p_id uuid,p_generation integer) RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM daily_snapshot_work WHERE id=p_id AND generation=p_generation AND status='running' AND lease_until>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'snapshot_worker_expired'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION assert_daily_snapshot_fence(uuid,integer) FROM PUBLIC,varda_tenant_app;

-- Release admission is enforced in the database, including old deployments.
-- The version stamp identifies compatible code; it does not grant tenant access.
CREATE TABLE trade_reliability_runtime (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 mode text NOT NULL DEFAULT 'legacy' CHECK(mode IN('legacy','compatible','paused')),
 reason text NOT NULL DEFAULT '0059 installed; compatible release not activated',
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO trade_reliability_runtime(singleton) VALUES(true);
ALTER TABLE trade_reliability_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_reliability_runtime FORCE ROW LEVEL SECURITY;
REVOKE ALL ON trade_reliability_runtime FROM PUBLIC,varda_tenant_app;

CREATE FUNCTION assert_trade_reliability_write(p_require_compatible boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE m text;
BEGIN
 -- Held until commit. A mode change waits for admitted financial transactions.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('cairn.trade_reliability.release.v1',0));
 SELECT mode INTO m FROM public.trade_reliability_runtime WHERE singleton;
 IF m IS NULL OR m='paused' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='financial_writes_paused'; END IF;
 IF (m='compatible' OR p_require_compatible) AND current_setting('app.trade_reliability_version',true) IS DISTINCT FROM '0059'
 THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='financial_writer_incompatible'; END IF;
 IF p_require_compatible AND m<>'compatible' THEN RAISE EXCEPTION USING ERRCODE='55000',MESSAGE='financial_release_not_activated'; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION assert_trade_reliability_write(boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_trade_reliability_write(boolean) TO varda_tenant_app;

CREATE FUNCTION set_trade_reliability_mode(p_mode text,p_reason text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF p_mode NOT IN('legacy','compatible','paused') OR length(trim(p_reason)) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid_release_mode'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cairn.trade_reliability.release.v1',0));
 IF p_mode='legacy' AND (EXISTS(SELECT 1 FROM public.native_ledger_revisions) OR EXISTS(SELECT 1 FROM public.native_operation_cancellations))
 THEN RAISE EXCEPTION 'legacy_rollback_unsafe'; END IF;
 UPDATE public.trade_reliability_runtime SET mode=p_mode,reason=p_reason,changed_at=clock_timestamp() WHERE singleton;
 RETURN p_mode;
END $$;
REVOKE ALL ON FUNCTION set_trade_reliability_mode(text,text) FROM PUBLIC,varda_tenant_app;

CREATE FUNCTION guard_trade_reliability_write() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_trade_reliability_write(TG_TABLE_NAME IN('native_ledger_revisions','native_operation_cancellations'));
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION guard_trade_reliability_write() FROM PUBLIC,varda_tenant_app;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['accounts','assets','event_ledger_entries','account_balance_snapshots','daily_portfolio_snapshots','daily_position_snapshots','native_ledger_revisions','native_operation_cancellations','daily_snapshot_work'] LOOP
  EXECUTE format('CREATE TRIGGER trade_reliability_write_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_trade_reliability_write()',t);
 END LOOP;
END $$;
