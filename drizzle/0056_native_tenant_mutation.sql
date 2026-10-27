-- The legacy trusted implementation stays private. Normal app sessions receive
-- only this fixed, owner-checked entry point; no direct financial DML grants.
CREATE FUNCTION public.apply_native_portfolio_tenant_mutation(p_owner uuid,p_operation uuid,p_request jsonb,p_changes jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result text; c jsonb;
BEGIN
 IF p_owner IS DISTINCT FROM nullif(current_setting('app.current_user_id',true),'')::uuid OR NOT public.investment_plan_tenant_active() THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native_owner_invalid';
 END IF;
 IF (jsonb_typeof(p_changes)='array' AND jsonb_array_length(p_changes) BETWEEN 1 AND 2) IS NOT TRUE THEN
  RAISE EXCEPTION 'native_invalid_changes';
 END IF;
 -- Reject foreign/missing accounts before the private writer acquires any row lock.
 IF (SELECT count(DISTINCT a.id) FROM jsonb_array_elements(p_changes) change_row(value)
     JOIN public.accounts a ON a.id=(change_row.value->>'accountId')::uuid
     WHERE a.canonical_owner_user_id=p_owner AND a.is_active) <> jsonb_array_length(p_changes) THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native_owner_invalid';
 END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  IF c->'event' ? 'assetId' AND NOT EXISTS (
   SELECT 1 FROM public.assets a WHERE a.id=(c->'event'->>'assetId')::uuid
    AND a.account_id=(c->>'accountId')::uuid AND a.canonical_owner_user_id=p_owner
  ) AND (c->'newAsset'->>'id'=c->'event'->>'assetId' AND c->'event'->>'type'='buy') IS NOT TRUE THEN
   RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='native_owner_invalid';
  END IF;
 END LOOP;
 result := public.apply_native_portfolio_mutation(p_owner,p_operation,p_request,p_changes);
 -- Validate the final atomic state while the narrow writer still owns the
 -- required row locks. Do not grant callers UPDATE merely for deferred checks.
 SET CONSTRAINTS public.native_asset_lifecycle_guard, public.native_account_lifecycle_guard IMMEDIATE;
 SET CONSTRAINTS public.native_asset_lifecycle_guard, public.native_account_lifecycle_guard DEFERRED;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.apply_native_portfolio_tenant_mutation(uuid,uuid,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_native_portfolio_tenant_mutation(uuid,uuid,jsonb,jsonb) TO varda_tenant_app;
