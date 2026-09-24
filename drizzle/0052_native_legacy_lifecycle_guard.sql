-- Keep legacy/current-state writers from diverging from the opt-in native ledger.
-- Deferred validation observes the final assets + native_state of a real atomic trade.
CREATE FUNCTION native_account_assets_match(p_account uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, public AS $$
 SELECT NOT EXISTS (
  SELECT 1 FROM public.assets h JOIN public.accounts a ON a.id=h.account_id
  WHERE a.id=p_account AND a.native_state IS NOT NULL AND h.archived_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.native_state->'positions') p
      WHERE p->>'assetId'=h.id::text AND p->>'currency'=h.currency
        AND (p->>'quantity')::numeric=h.quantity AND h.quantity>0
        AND h.canonical_owner_user_id=a.canonical_owner_user_id AND h.account=a.code)
 ) AND NOT EXISTS (
  SELECT 1 FROM public.accounts a CROSS JOIN LATERAL jsonb_array_elements(a.native_state->'positions') p
  WHERE a.id=p_account AND a.native_state IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.assets h WHERE h.id=(p->>'assetId')::uuid
      AND h.account_id=a.id AND h.canonical_owner_user_id=a.canonical_owner_user_id AND h.account=a.code
      AND h.currency=p->>'currency' AND h.quantity=(p->>'quantity')::numeric
      AND (h.archived_at IS NOT NULL)=((p->>'quantity')::numeric=0))
 );
$$;
CREATE FUNCTION guard_native_asset_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE a public.accounts%ROWTYPE; old_native boolean := false;
BEGIN
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
  IF TG_OP='INSERT' AND a.native_state IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(a.native_state->'positions') p WHERE p->>'assetId'=NEW.id::text
  ) THEN RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='native_ledger_required'; END IF;
  IF a.native_state IS NOT NULL AND NOT public.native_account_assets_match(a.id) THEN
   RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='native_ledger_required';
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER native_asset_lifecycle_guard AFTER INSERT OR UPDATE OR DELETE ON assets
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_native_asset_lifecycle();

CREATE FUNCTION guard_native_account_lifecycle() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE a public.accounts%ROWTYPE;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.native_state IS NOT NULL THEN RAISE EXCEPTION USING ERRCODE='N0002', MESSAGE='native_account_history_required'; END IF;
  RETURN NULL;
 END IF;
 IF TG_OP='UPDATE' AND OLD.native_state IS NOT NULL AND
   (NEW.native_state IS NULL OR ROW(OLD.id,OLD.code,OLD.canonical_owner_user_id) IS DISTINCT FROM ROW(NEW.id,NEW.code,NEW.canonical_owner_user_id)) THEN
  RAISE EXCEPTION USING ERRCODE='N0002', MESSAGE='native_account_history_required';
 END IF;
 SELECT * INTO a FROM public.accounts WHERE id=NEW.id FOR UPDATE;
 IF a.native_state IS NULL THEN RETURN NULL; END IF;
 IF NOT a.is_active AND (EXISTS (SELECT 1 FROM jsonb_each_text(a.native_state->'cash') c WHERE c.value::numeric<>0)
   OR EXISTS (SELECT 1 FROM jsonb_array_elements(a.native_state->'positions') p WHERE (p->>'quantity')::numeric<>0)) THEN
  RAISE EXCEPTION USING ERRCODE='N0002', MESSAGE='native_account_balance_remaining';
 END IF;
 IF NOT public.native_account_assets_match(a.id) THEN RAISE EXCEPTION USING ERRCODE='N0001', MESSAGE='native_ledger_required'; END IF;
 IF (TG_OP='INSERT' OR OLD.native_state IS DISTINCT FROM NEW.native_state) AND NOT EXISTS (
  SELECT 1 FROM public.event_ledger_entries e WHERE e.account_id=a.id AND e.canonical_owner_user_id=a.canonical_owner_user_id
    AND e.native_sequence=(a.native_state->>'sequence')::integer AND e.native_data->'state'=a.native_state
 ) THEN RAISE EXCEPTION USING ERRCODE='N0002', MESSAGE='native_account_evidence_required'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER native_account_lifecycle_guard AFTER INSERT OR UPDATE OR DELETE ON accounts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_native_account_lifecycle();
