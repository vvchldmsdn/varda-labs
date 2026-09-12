-- A boolean-only predicate avoids granting tenant connections access to app_users.
-- No caller-supplied identity or mutable search_path is accepted.
CREATE FUNCTION public.investment_plan_tenant_active() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$ SELECT EXISTS (SELECT 1 FROM public.app_users
  WHERE id = nullif(current_setting('app.current_user_id', true), '')::uuid AND status = 'active') $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.investment_plan_tenant_active() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.investment_plan_tenant_active() TO varda_tenant_app;
--> statement-breakpoint
CREATE TABLE "investment_plans" (
	"owner_user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"input_json" jsonb NOT NULL,
	"engine_version" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "investment_plans_owner_user_id_id_pk" PRIMARY KEY("owner_user_id","id"),
	CONSTRAINT "investment_plans_input_check" CHECK (jsonb_typeof("investment_plans"."input_json") = 'object' and octet_length("investment_plans"."input_json"::text) <= 4096),
	CONSTRAINT "investment_plans_engine_check" CHECK ("investment_plans"."engine_version" = 'deficit_proportional_capped_v1')
);
--> statement-breakpoint
ALTER TABLE "investment_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "investment_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "investment_plans" ADD CONSTRAINT "investment_plans_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "investment_plans_owner_created_idx" ON "investment_plans" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE POLICY "investment_plans_tenant_select_v1" ON "investment_plans" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("investment_plans"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid and investment_plan_tenant_active());--> statement-breakpoint
CREATE POLICY "investment_plans_tenant_insert_v1" ON "investment_plans" AS PERMISSIVE FOR INSERT TO "varda_tenant_app" WITH CHECK ("investment_plans"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid and investment_plan_tenant_active());--> statement-breakpoint
CREATE POLICY "investment_plans_tenant_delete_v1" ON "investment_plans" AS PERMISSIVE FOR DELETE TO "varda_tenant_app" USING ("investment_plans"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid and investment_plan_tenant_active());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "investment_plans" TO "varda_tenant_app";
