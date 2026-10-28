-- Derived values only: original recovery, transactions, cash and observations remain immutable.
CREATE TABLE recovered_close_valuations (
 canonical_owner_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 account_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),
 valuation_date date NOT NULL,
 value_krw numeric(36,12) NOT NULL CHECK(value_krw>0),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,revision,valuation_date),
 FOREIGN KEY(account_id,canonical_owner_user_id) REFERENCES accounts(id,canonical_owner_user_id) ON DELETE RESTRICT
);
ALTER TABLE recovered_close_valuations ENABLE ROW LEVEL SECURITY;
CREATE POLICY recovered_close_valuations_owner ON recovered_close_valuations FOR SELECT TO varda_tenant_app
 USING(canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
GRANT SELECT ON recovered_close_valuations TO varda_tenant_app;
CREATE FUNCTION reject_recovered_close_valuation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'recovered_close_valuations_are_append_only'; END $$;
CREATE TRIGGER recovered_close_valuations_immutable BEFORE UPDATE OR DELETE ON recovered_close_valuations
 FOR EACH ROW EXECUTE FUNCTION reject_recovered_close_valuation_mutation();
