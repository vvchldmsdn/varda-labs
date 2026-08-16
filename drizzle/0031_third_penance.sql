ALTER TABLE "daily_portfolio_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_position_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "daily_portfolio_snapshots_tenant_select_v1" ON "daily_portfolio_snapshots" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("daily_portfolio_snapshots"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "daily_position_snapshots_tenant_select_v1" ON "daily_position_snapshots" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("daily_position_snapshots"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON TABLE "daily_portfolio_snapshots" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "daily_position_snapshots" TO "varda_tenant_app";
