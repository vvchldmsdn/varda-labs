-- A historical instrument can need a foreign-key identity after its last sale.
-- Only the table-owning operator may materialize it, with both the approved
-- publication and a physical position/portfolio receipt in the same database.
CREATE OR REPLACE FUNCTION public.guard_native_asset_lifecycle() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE
 a public.accounts%ROWTYPE;
 old_native boolean := false;
 review_hash text := current_setting('app.reviewed_close_hash', true);
 marker constant text := 'broker_account_review_close_v1:';
BEGIN
 IF TG_OP='UPDATE' AND OLD.created_by_id ~ '^broker_account_review_close_v1:[0-9a-f]{64}$' THEN
  IF NEW.created_by_id IS DISTINCT FROM OLD.created_by_id THEN
   RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='reviewed_identity_is_immutable';
  END IF;
  IF OLD.archived_at IS NOT NULL AND NEW IS DISTINCT FROM OLD AND NOT EXISTS (
   SELECT 1 FROM public.accounts ac CROSS JOIN LATERAL jsonb_array_elements(ac.native_state->'positions') p
   WHERE ac.id=OLD.account_id AND ac.canonical_owner_user_id=OLD.canonical_owner_user_id
     AND p->>'assetId'=OLD.id::text AND p->>'currency'=NEW.currency
     AND (p->>'quantity')::numeric=NEW.quantity AND NEW.quantity>0 AND NEW.archived_at IS NULL
  ) THEN RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='reviewed_identity_is_immutable'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND starts_with(NEW.created_by_id,marker) AND NEW.created_by_id IS DISTINCT FROM OLD.created_by_id THEN
  RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='reviewed_identity_requires_publication';
 END IF;
 IF TG_OP='UPDATE' AND ROW(OLD.id,OLD.account_id,OLD.account,OLD.canonical_owner_user_id,OLD.quantity,OLD.average_cost,OLD.currency,OLD.ticker,OLD.market,OLD.asset_type,OLD.archived_at)
   IS NOT DISTINCT FROM ROW(NEW.id,NEW.account_id,NEW.account,NEW.canonical_owner_user_id,NEW.quantity,NEW.average_cost,NEW.currency,NEW.ticker,NEW.market,NEW.asset_type,NEW.archived_at) THEN RETURN NULL; END IF;
 IF TG_OP<>'INSERT' THEN
  SELECT native_state IS NOT NULL INTO old_native FROM public.accounts WHERE id=OLD.account_id FOR UPDATE;
  IF old_native AND (TG_OP='DELETE' OR ROW(OLD.id,OLD.account_id,OLD.account,OLD.canonical_owner_user_id,OLD.average_cost,OLD.currency,OLD.ticker,OLD.market,OLD.asset_type)
    IS DISTINCT FROM ROW(NEW.id,NEW.account_id,NEW.account,NEW.canonical_owner_user_id,NEW.average_cost,NEW.currency,NEW.ticker,NEW.market,NEW.asset_type)) THEN
   RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='native_ledger_required';
  END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  SELECT * INTO a FROM public.accounts WHERE id=NEW.account_id FOR UPDATE;
  IF TG_OP='INSERT' AND starts_with(NEW.created_by_id,marker) THEN
   IF (
    pg_has_role((SELECT relowner FROM pg_class WHERE oid='public.assets'::regclass),'USAGE')
    AND current_setting('app.current_user_id',true)=a.canonical_owner_user_id::text
    AND review_hash ~ '^[0-9a-f]{64}$' AND NEW.created_by_id=marker || review_hash
    AND NEW.archived_at IS NOT NULL AND NEW.quantity=0 AND NEW.current_price=0
    AND NEW.legacy_base44_id IS NULL AND NEW.asset_type IS NULL AND NEW.average_cost IS NULL
    AND NEW.fractional_krw_value IS NULL AND NEW.fractional_avg_cost IS NULL AND NEW.target_weight IS NULL
    AND NEW.monthly_contribution IS NULL AND NEW.contribution_day IS NULL AND NEW.group_id IS NULL
    AND NEW.category IS NULL AND NEW.ma_asset_class IS NULL AND NEW.ma_rule_enabled IS FALSE
    AND NEW.ma_120 IS NULL AND coalesce(NEW.days_above_ma,0)=0 AND NEW.price_source IS NULL
    AND NEW.price_fetched_at IS NULL AND NEW.price_as_of IS NULL AND NEW.price_quote_type IS NULL
    AND NEW.price_status IS NULL AND NEW.price_error IS NULL AND NEW.memo IS NULL
    AND NEW.description='Archived historical instrument for broker_account_review_close_v1'
    AND NEW.ticker IS NOT NULL AND a.native_state IS NOT NULL AND a.is_active AND a.code=NEW.account
    AND a.canonical_owner_user_id=NEW.canonical_owner_user_id
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.native_state->'positions') p WHERE p->>'assetId'=NEW.id::text)
    AND NOT EXISTS (SELECT 1 FROM public.assets h WHERE h.account_id=a.id AND h.canonical_owner_user_id=a.canonical_owner_user_id
      AND h.id<>NEW.id AND (upper(btrim(h.ticker))=upper(btrim(NEW.ticker)) OR btrim(h.name)=btrim(NEW.name)))
    AND EXISTS (
     SELECT 1 FROM (SELECT evidence_hash,points,captured_revision FROM public.account_history_reviews
       WHERE canonical_owner_user_id=a.canonical_owner_user_id AND account_id=a.id
       ORDER BY created_at DESC,evidence_hash DESC LIMIT 1) r
     JOIN public.daily_position_snapshots s ON s.canonical_owner_user_id=a.canonical_owner_user_id AND s.account_id=a.id
       AND s.account=a.code AND s.asset_id=NEW.id AND s.source='varda_manual_daily_snapshot' AND NOT s.is_sample
       AND s.asset_name=NEW.name AND s.ticker=NEW.ticker AND s.currency=NEW.currency AND s.market=NEW.market
     JOIN public.daily_portfolio_snapshots c ON c.canonical_owner_user_id=s.canonical_owner_user_id AND c.account_id=s.account_id
       AND c.account=s.account AND c.snapshot_date=s.snapshot_date AND c.source=s.source AND NOT c.is_sample
       AND c.rule_version='broker_account_review_close_v1' AND c.closing_performance->>'reviewEvidenceHash'=r.evidence_hash
     CROSS JOIN LATERAL jsonb_array_elements(r.points) pt
     CROSS JOIN LATERAL jsonb_array_elements(pt->'positions') pos
     WHERE r.evidence_hash=review_hash AND pt->>'date'=s.snapshot_date::text
       AND pos->>'name'=NEW.name AND pos->>'ticker'=NEW.ticker AND pos->>'market'=NEW.market AND pos->>'currency'=NEW.currency
       AND s.quantity>0 AND s.unit_price>0 AND s.fx_rate>0 AND s.market_value_krw>0
       AND abs(s.quantity-(pos->>'quantity')::numeric)<0.00000001
       AND abs(s.unit_price-(pos->>'price')::numeric)<0.000001 AND abs(s.fx_rate-(pos->>'fxRate')::numeric)<0.000001
       AND abs(s.market_value_krw-(pos->>'valueKrw')::numeric)<0.000001
       AND abs(c.total_market_value-(pt->>'valueKrw')::numeric)<0.000001
       AND NOT EXISTS (SELECT 1 FROM public.native_ledger_revisions v WHERE v.canonical_owner_user_id=a.canonical_owner_user_id
         AND v.account_id=a.id AND v.marker_sequence>r.captured_revision AND v.affected_at<c.cycle_end_at)
    )
   ) IS NOT TRUE THEN RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='reviewed_identity_requires_publication'; END IF;
  ELSIF TG_OP='INSERT' AND a.native_state IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(a.native_state->'positions') p WHERE p->>'assetId'=NEW.id::text
  ) THEN RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='native_ledger_required'; END IF;
  IF a.native_state IS NOT NULL AND NOT public.native_account_assets_match(a.id) THEN
   RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='native_ledger_required';
  END IF;
 END IF;
 RETURN NULL;
END $$;
