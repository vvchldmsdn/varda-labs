ALTER TABLE "market_regime_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "market_regime_daily_tenant_select_v1" ON "market_regime_daily" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("market_regime_daily"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "settings_tenant_select_v1" ON "settings" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("settings"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON TABLE "market_regime_daily" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "settings" TO "varda_tenant_app";
