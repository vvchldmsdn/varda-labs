-- Additive compatibility: retain v1 captures and events. A zero manual price is
-- an unavailable marker, never a USD price inferred from KRW settlement.
ALTER TABLE daily_portfolio_snapshots DROP CONSTRAINT snapshot_native_evidence_check;
ALTER TABLE daily_portfolio_snapshots ADD CONSTRAINT snapshot_native_evidence_check CHECK (native_evidence IS NULL OR (source IN ('native_ledger_v1','native_ledger_cutoff_v2') AND NOT is_sample AND octet_length(native_evidence::text)<=2000000));

CREATE OR REPLACE FUNCTION apply_native_portfolio_mutation(p_owner uuid, p_operation uuid, p_request jsonb, p_changes jsonb)
RETURNS text LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE c jsonb; a public.accounts%ROWTYPE; existing jsonb; actual jsonb; pos jsonb; n jsonb; entry jsonb;
BEGIN
 IF jsonb_typeof(p_changes) <> 'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 2 THEN RAISE EXCEPTION 'native_invalid_changes'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.app_users WHERE id = p_owner AND status = 'active') THEN RETURN 'inactive'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('varda.portfolio_mutation.v1:' || p_owner::text, 0));
 SELECT native_data->'request' INTO existing FROM public.event_ledger_entries WHERE canonical_owner_user_id=p_owner AND native_operation_id=p_operation LIMIT 1;
 IF FOUND THEN RETURN CASE WHEN existing = p_request THEN 'existing' ELSE 'conflict' END; END IF;
 -- Lock the complete account/holding set before checking either leg.
 PERFORM 1 FROM public.accounts WHERE id IN (SELECT (value->>'accountId')::uuid FROM jsonb_array_elements(p_changes)) ORDER BY id FOR UPDATE;
 PERFORM 1 FROM public.assets WHERE account_id IN (SELECT (value->>'accountId')::uuid FROM jsonb_array_elements(p_changes)) ORDER BY id FOR UPDATE;
 FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  SELECT * INTO a FROM public.accounts WHERE id=(c->>'accountId')::uuid AND canonical_owner_user_id=p_owner AND is_active;
  IF NOT FOUND OR COALESCE(a.native_state,'null'::jsonb) <> c->'expectedState' THEN RETURN 'conflict'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'quantity',quantity::text,'currency',currency,'archived',archived_at IS NOT NULL,'name',name,'ticker',ticker,'market',market,'assetType',asset_type) ORDER BY id),'[]'::jsonb)
  INTO actual FROM public.assets WHERE account_id=a.id AND canonical_owner_user_id=p_owner;
  IF actual <> c->'expectedAssets' THEN RETURN 'conflict'; END IF;
  -- Snapshot capture uses the same owner lock. Recheck every leg here, after
  -- acquiring it: a snapshot committed after the application read must fence
  -- a backdated event without changing the already recorded valuation.
  IF c->'event'->>'type' <> 'opening' AND EXISTS (
   SELECT 1 FROM public.daily_portfolio_snapshots s
   WHERE s.canonical_owner_user_id=p_owner AND s.account_id=a.id AND s.native_evidence IS NOT NULL
    AND ((s.native_evidence->'frame'->>'at')::timestamptz > (c->'event'->>'at')::timestamptz OR ((s.native_evidence->'frame'->>'at')::timestamptz = (c->'event'->>'at')::timestamptz AND s.native_evidence->'frame'->>'boundary' IS DISTINCT FROM 'before'))
  ) THEN RETURN 'event_precedes_recorded_snapshot'; END IF;
 END LOOP;
 FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  SELECT * INTO a FROM public.accounts WHERE id=(c->>'accountId')::uuid AND canonical_owner_user_id=p_owner;
  n := c->'next'; entry := c->'event';
  IF c->'newAsset' IS NOT NULL AND c->'newAsset' <> 'null'::jsonb THEN
   pos := c->'newAsset';
   IF EXISTS(SELECT 1 FROM public.assets h WHERE h.canonical_owner_user_id=p_owner AND h.account_id=a.id AND upper(h.ticker)=upper(pos->>'ticker') AND h.market=pos->>'market') THEN RAISE EXCEPTION 'native_instrument_identity_conflict'; END IF;
   INSERT INTO public.assets(id,canonical_owner_user_id,account_id,account,name,ticker,market,currency,asset_type,quantity,current_price,price_source,price_status)
   VALUES ((pos->>'id')::uuid,p_owner,a.id,a.code,pos->>'name',pos->>'ticker',pos->>'market',pos->>'currency',pos->>'assetType',0,COALESCE((entry->>'price')::numeric,(entry->'executionUnitPrice'->>'amount')::numeric,0),'user_native_trade','manual');
  END IF;
  FOR pos IN SELECT value FROM jsonb_array_elements(n->'positions') LOOP
   UPDATE public.assets SET quantity=(pos->>'quantity')::numeric,
    archived_at=CASE WHEN (pos->>'quantity')::numeric=0 THEN COALESCE(archived_at,now()) ELSE NULL END,
    updated_at=now()
   WHERE id=(pos->>'assetId')::uuid AND account_id=a.id AND canonical_owner_user_id=p_owner AND currency=pos->>'currency';
   IF NOT FOUND THEN RAISE EXCEPTION 'native_asset_scope_mismatch'; END IF;
  END LOOP;
  UPDATE public.accounts SET native_state=n,updated_at=now() WHERE id=a.id AND canonical_owner_user_id=p_owner;
  INSERT INTO public.event_ledger_entries(id,canonical_owner_user_id,event_date,event_type,source,recorded_at,rule_version,account,account_id,asset_id,legacy_asset_id,asset_name,before_value,after_value,native_sequence,native_operation_id,native_data)
  VALUES ((c->>'entryId')::uuid,p_owner,(c->>'serviceDate')::date,'native_' || (entry->>'type'),'native_ledger_v1',now(),'native_ledger_v1',a.code,a.id,
   CASE WHEN entry ? 'assetId' THEN (entry->>'assetId')::uuid ELSE NULL END,NULL,
   COALESCE((SELECT name FROM public.assets WHERE id=(entry->>'assetId')::uuid AND canonical_owner_user_id=p_owner),a.name),
   COALESCE(a.native_state,'null'::jsonb)::text,n::text,(n->>'sequence')::integer,p_operation,
   jsonb_build_object('request',p_request,'event',entry,'effect',c->'effect','state',n));
 END LOOP;
 RETURN 'created';
END $$;
REVOKE ALL ON FUNCTION apply_native_portfolio_mutation(uuid,uuid,jsonb,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_native_portfolio_mutation(uuid,uuid,jsonb,jsonb) FROM varda_tenant_app;
