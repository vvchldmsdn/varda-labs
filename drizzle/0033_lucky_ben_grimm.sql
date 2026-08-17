ALTER TABLE "asset_group_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "asset_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_group_account_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_group_asset_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "asset_group_members_tenant_select_v1" ON "asset_group_members" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("asset_group_members"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "asset_groups_tenant_select_v1" ON "asset_groups" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("asset_groups"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "portfolio_group_account_memberships_tenant_select_v1" ON "portfolio_group_account_memberships" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("portfolio_group_account_memberships"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "portfolio_group_asset_memberships_tenant_select_v1" ON "portfolio_group_asset_memberships" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("portfolio_group_asset_memberships"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "portfolio_groups_tenant_select_v1" ON "portfolio_groups" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("portfolio_groups"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON TABLE "asset_group_members" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "asset_groups" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "portfolio_group_account_memberships" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "portfolio_group_asset_memberships" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "portfolio_groups" TO "varda_tenant_app";
