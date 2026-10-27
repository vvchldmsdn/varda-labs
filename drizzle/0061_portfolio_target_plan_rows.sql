-- Planned instruments are not holdings. Existing v1 approvals and asset FKs remain intact.
CREATE TABLE portfolio_target_plan_rows (
 approval_revision_id uuid NOT NULL,
 canonical_owner_user_id uuid NOT NULL,
 plan_row_id uuid NOT NULL,
 account_id uuid NOT NULL,
 origin_asset_id uuid,
 asset_name varchar(255) NOT NULL CHECK(length(trim(asset_name))>0),
 asset_type varchar(30),
 market varchar(20) NOT NULL CHECK(market=lower(trim(market)) AND length(market)>0),
 currency varchar(10) NOT NULL CHECK(currency=upper(trim(currency)) AND length(currency)>0),
 ticker varchar(50),
 buyability varchar(32) NOT NULL CHECK(buyability IN('buyable','not_buyable','tickerless','unsupported_market','unsupported_currency')),
 target_weight_bps integer NOT NULL CHECK(target_weight_bps BETWEEN 0 AND 10000),
 CONSTRAINT portfolio_target_plan_rows_pk PRIMARY KEY(approval_revision_id,plan_row_id),
 CONSTRAINT portfolio_target_plan_revision_owner_fk FOREIGN KEY(approval_revision_id,canonical_owner_user_id) REFERENCES portfolio_target_policy_revisions(id,canonical_owner_user_id) ON DELETE RESTRICT,
 CONSTRAINT portfolio_target_plan_account_owner_fk FOREIGN KEY(account_id,canonical_owner_user_id) REFERENCES accounts(id,canonical_owner_user_id) ON DELETE RESTRICT,
 CONSTRAINT portfolio_target_plan_asset_owner_fk FOREIGN KEY(origin_asset_id,canonical_owner_user_id) REFERENCES assets(id,canonical_owner_user_id) ON DELETE RESTRICT,
 CONSTRAINT portfolio_target_plan_asset_account_fk FOREIGN KEY(origin_asset_id,account_id) REFERENCES assets(id,account_id) ON DELETE RESTRICT,
 CHECK(ticker IS NULL OR (ticker=upper(trim(ticker)) AND length(ticker)>0)),
 CONSTRAINT portfolio_target_plan_candidate_check CHECK(origin_asset_id IS NOT NULL OR (ticker IS NOT NULL AND (market,currency) IN (('korea','KRW'),('us','USD')))),
 CHECK(target_weight_bps=0 OR buyability='buyable')
);
CREATE UNIQUE INDEX portfolio_target_plan_instrument_unique
 ON portfolio_target_plan_rows(approval_revision_id,account_id,market,currency,ticker) WHERE ticker IS NOT NULL;
CREATE INDEX portfolio_target_plan_owner_idx ON portfolio_target_plan_rows(canonical_owner_user_id);
CREATE INDEX portfolio_target_plan_account_idx ON portfolio_target_plan_rows(account_id);
CREATE INDEX portfolio_target_plan_asset_idx ON portfolio_target_plan_rows(origin_asset_id);
ALTER TABLE portfolio_target_plan_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_target_plan_rows FORCE ROW LEVEL SECURITY;
CREATE POLICY portfolio_target_plan_rows_tenant_select_v1 ON portfolio_target_plan_rows FOR SELECT TO varda_tenant_app
 USING(canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid);
GRANT SELECT ON portfolio_target_plan_rows TO varda_tenant_app;
ALTER TABLE portfolio_target_policy_revisions DROP CONSTRAINT portfolio_target_revisions_policy_version_check;
ALTER TABLE portfolio_target_policy_revisions ADD CONSTRAINT portfolio_target_revisions_policy_version_check
 CHECK(policy_version IN ('portfolio_target_policy_v1','portfolio_target_policy_v2'));
