ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "assets_tenant_select_v1" ON "assets" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("assets"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON TABLE "assets" TO "varda_tenant_app";
