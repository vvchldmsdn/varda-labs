ALTER TABLE "portfolio_target_policy_lifecycle_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "target_policy_approval_lifecycle_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "target_policy_approval_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "target_policy_approval_vector_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "portfolio_target_policy_events_tenant_select_v1" ON "portfolio_target_policy_lifecycle_events" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("portfolio_target_policy_lifecycle_events"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "portfolio_target_policy_revisions_tenant_select_v1" ON "portfolio_target_policy_revisions" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("portfolio_target_policy_revisions"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "portfolio_target_policy_rows_tenant_select_v1" ON "portfolio_target_policy_rows" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("portfolio_target_policy_rows"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "target_policy_events_tenant_select_v1" ON "target_policy_approval_lifecycle_events" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING (exists (
          select 1
          from "target_policy_approval_revisions"
          where "target_policy_approval_revisions"."id" = "target_policy_approval_lifecycle_events"."approval_revision_id"
            and "target_policy_approval_revisions"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid
        ));--> statement-breakpoint
CREATE POLICY "target_policy_revisions_tenant_select_v1" ON "target_policy_approval_revisions" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("target_policy_approval_revisions"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "target_policy_vector_rows_tenant_select_v1" ON "target_policy_approval_vector_rows" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING (exists (
          select 1
          from "target_policy_approval_revisions"
          where "target_policy_approval_revisions"."id" = "target_policy_approval_vector_rows"."approval_revision_id"
            and "target_policy_approval_revisions"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid
        ));--> statement-breakpoint
GRANT SELECT ON TABLE "portfolio_target_policy_lifecycle_events" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "portfolio_target_policy_revisions" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "portfolio_target_policy_rows" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "target_policy_approval_lifecycle_events" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "target_policy_approval_revisions" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "target_policy_approval_vector_rows" TO "varda_tenant_app";
