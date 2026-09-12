CREATE TABLE "portfolio_drafts" (
	"owner_user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"input_json" jsonb NOT NULL,
	"engine_version" varchar(80) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_drafts_owner_user_id_id_pk" PRIMARY KEY("owner_user_id","id"),
	CONSTRAINT "portfolio_drafts_input_check" CHECK (jsonb_typeof("portfolio_drafts"."input_json") = 'object' and octet_length("portfolio_drafts"."input_json"::text) <= 4096),
	CONSTRAINT "portfolio_drafts_engine_check" CHECK ("portfolio_drafts"."engine_version" = 'amount_composition_v1')
);
--> statement-breakpoint
ALTER TABLE "portfolio_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_drafts" ADD CONSTRAINT "portfolio_drafts_owner_user_id_app_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "portfolio_drafts_owner_created_idx" ON "portfolio_drafts" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE POLICY "portfolio_drafts_tenant_select_v1" ON "portfolio_drafts" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("portfolio_drafts"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid and investment_plan_tenant_active());--> statement-breakpoint
CREATE POLICY "portfolio_drafts_tenant_insert_v1" ON "portfolio_drafts" AS PERMISSIVE FOR INSERT TO "varda_tenant_app" WITH CHECK ("portfolio_drafts"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid and investment_plan_tenant_active());--> statement-breakpoint
CREATE POLICY "portfolio_drafts_tenant_delete_v1" ON "portfolio_drafts" AS PERMISSIVE FOR DELETE TO "varda_tenant_app" USING ("portfolio_drafts"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid and investment_plan_tenant_active());
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE "portfolio_drafts" TO "varda_tenant_app";
