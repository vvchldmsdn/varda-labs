-- Recovery evidence does not initialize native cash or rewrite historical NAV.
CREATE TABLE broker_recovery_batches (
 id uuid PRIMARY KEY,
 canonical_owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 account_id uuid NOT NULL,
 manifest_hash varchar(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
 expected_state_hash varchar(64) NOT NULL CHECK (expected_state_hash ~ '^[a-f0-9]{64}$'),
 before_state jsonb NOT NULL,
 after_state jsonb NOT NULL,
 manifest jsonb NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT broker_recovery_account_owner_fk FOREIGN KEY(account_id,canonical_owner_user_id) REFERENCES accounts(id,canonical_owner_user_id) ON DELETE RESTRICT,
 CONSTRAINT broker_recovery_batch_owner_account_unique UNIQUE(id,canonical_owner_user_id,account_id),
 CONSTRAINT broker_recovery_manifest_unique UNIQUE(canonical_owner_user_id,account_id,manifest_hash)
);
ALTER TABLE broker_recovery_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY broker_recovery_tenant_select ON broker_recovery_batches FOR SELECT TO varda_tenant_app
 USING (canonical_owner_user_id = nullif(current_setting('app.current_user_id',true),'')::uuid);
GRANT SELECT ON broker_recovery_batches TO varda_tenant_app;

ALTER TABLE event_ledger_entries ADD COLUMN broker_recovery_batch_id uuid;
ALTER TABLE event_ledger_entries ADD COLUMN broker_recovery_data jsonb;
ALTER TABLE event_ledger_entries ADD COLUMN broker_recovery_asset_id uuid GENERATED ALWAYS AS (CASE WHEN broker_recovery_batch_id IS NOT NULL THEN asset_id ELSE NULL END) STORED;
ALTER TABLE event_ledger_entries ADD CONSTRAINT event_broker_recovery_asset_owner_fk FOREIGN KEY(broker_recovery_asset_id,canonical_owner_user_id) REFERENCES assets(id,canonical_owner_user_id) ON DELETE RESTRICT;
ALTER TABLE event_ledger_entries ADD CONSTRAINT event_broker_recovery_asset_account_fk FOREIGN KEY(broker_recovery_asset_id,account_id) REFERENCES assets(id,account_id) ON DELETE RESTRICT;
ALTER TABLE event_ledger_entries ADD CONSTRAINT event_broker_recovery_batch_fk
 FOREIGN KEY (broker_recovery_batch_id,canonical_owner_user_id,account_id)
 REFERENCES broker_recovery_batches(id,canonical_owner_user_id,account_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX event_broker_recovery_row_unique ON event_ledger_entries(broker_recovery_batch_id,(broker_recovery_data->>'rowId')) WHERE broker_recovery_batch_id IS NOT NULL;
ALTER TABLE event_ledger_entries DROP CONSTRAINT event_ledger_native_check;
ALTER TABLE event_ledger_entries ADD CONSTRAINT event_ledger_native_check CHECK (
 (broker_recovery_batch_id IS NULL AND broker_recovery_data IS NULL AND (
  (native_data IS NULL AND native_sequence IS NULL AND native_operation_id IS NULL AND legacy_asset_id IS NOT NULL AND source IS DISTINCT FROM 'broker_recovery_v1') OR
  (native_data IS NOT NULL AND native_sequence >= 0 AND native_operation_id IS NOT NULL AND canonical_owner_user_id IS NOT NULL AND account_id IS NOT NULL AND source = 'native_ledger_v1' AND NOT is_sample)
 )) OR
 coalesce((broker_recovery_batch_id IS NOT NULL AND broker_recovery_data IS NOT NULL AND
  native_data IS NULL AND native_sequence IS NULL AND native_operation_id IS NULL AND
  canonical_owner_user_id IS NOT NULL AND account_id IS NOT NULL AND asset_id IS NOT NULL AND
  source = 'broker_recovery_v1' AND rule_version = 'broker_recovery_v1' AND event_type IN ('buy','sell') AND NOT is_sample AND
  broker_recovery_data->>'version' = '1' AND coalesce(length(broker_recovery_data->>'rowId'),0) BETWEEN 1 AND 120 AND
  broker_recovery_data->>'tradeDate' = event_date::text AND octet_length(broker_recovery_data::text) <= 32768),false)
);

CREATE FUNCTION check_broker_recovery_asset() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.broker_recovery_batch_id IS NOT NULL THEN
  PERFORM 1 FROM assets WHERE id=NEW.asset_id AND account_id=NEW.account_id AND canonical_owner_user_id=NEW.canonical_owner_user_id FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'broker_recovery_asset_scope_mismatch'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION check_broker_recovery_asset() FROM PUBLIC;
CREATE TRIGGER broker_recovery_asset_scope BEFORE INSERT OR UPDATE ON event_ledger_entries
 FOR EACH ROW EXECUTE FUNCTION check_broker_recovery_asset();
