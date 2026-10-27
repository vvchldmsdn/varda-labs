-- Frozen planning evidence is separate from positions, balances and executed transactions.
CREATE TABLE public.native_contribution_plans (
  owner_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  scope_key text NOT NULL,
  reporting_currency varchar(3) NOT NULL,
  request_json jsonb NOT NULL,
  document_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT native_contribution_plans_pk PRIMARY KEY(owner_user_id,id),
  CONSTRAINT native_contribution_plans_currency_check CHECK (reporting_currency IN ('KRW','USD')),
  CONSTRAINT native_contribution_plans_request_check CHECK (jsonb_typeof(request_json)='object' AND octet_length(request_json::text)<=4096),
  CONSTRAINT native_contribution_plans_document_check CHECK (jsonb_typeof(document_json)='object' AND octet_length(document_json::text)<=524288 AND document_json->>'version'='native_contribution_plan_v1' AND document_json->'result'->'context'->>'profitCurrency'=reporting_currency AND document_json->'result'->'context'->>'reportingCurrency'=reporting_currency)
);
--> statement-breakpoint
CREATE INDEX native_contribution_plans_owner_created_idx ON public.native_contribution_plans(owner_user_id,created_at);
--> statement-breakpoint
ALTER TABLE public.native_contribution_plans ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.native_contribution_plans FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY native_contribution_plans_tenant_select_v1 ON public.native_contribution_plans FOR SELECT TO varda_tenant_app USING (owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active());
--> statement-breakpoint
CREATE POLICY native_contribution_plans_tenant_insert_v1 ON public.native_contribution_plans FOR INSERT TO varda_tenant_app WITH CHECK (owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active());
--> statement-breakpoint
CREATE POLICY native_contribution_plans_tenant_delete_v1 ON public.native_contribution_plans FOR DELETE TO varda_tenant_app USING (owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid AND public.investment_plan_tenant_active());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON public.native_contribution_plans TO varda_tenant_app;
