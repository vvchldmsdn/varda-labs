ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "accounts_tenant_select_v1" ON "accounts" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("accounts"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON TABLE "accounts" TO "varda_tenant_app";
