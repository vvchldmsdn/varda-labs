ALTER TABLE "account_balance_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "account_balance_snapshots_tenant_select_v1" ON "account_balance_snapshots" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("account_balance_snapshots"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "event_ledger_entries_tenant_select_v1" ON "event_ledger_entries" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("event_ledger_entries"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT ON TABLE "account_balance_snapshots" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "event_ledger_entries" TO "varda_tenant_app";
