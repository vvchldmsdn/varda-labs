ALTER TABLE "holding_onboarding_evidence" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holding_state_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "simulation_scenario_approval_lifecycle_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "simulation_scenario_approval_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "simulation_scenario_approval_vector_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "holding_onboarding_evidence_tenant_select_v1" ON "holding_onboarding_evidence" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("holding_onboarding_evidence"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "holding_state_corrections_tenant_select_v1" ON "holding_state_corrections" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("holding_state_corrections"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "simulation_scenario_events_tenant_select_v1" ON "simulation_scenario_approval_lifecycle_events" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING (exists (
          select 1
          from "simulation_scenario_approval_revisions"
          where "simulation_scenario_approval_revisions"."id" = "simulation_scenario_approval_lifecycle_events"."approval_revision_id"
            and "simulation_scenario_approval_revisions"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid
        ));--> statement-breakpoint
CREATE POLICY "simulation_scenario_revisions_tenant_select_v1" ON "simulation_scenario_approval_revisions" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("simulation_scenario_approval_revisions"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "simulation_scenario_vector_rows_tenant_select_v1" ON "simulation_scenario_approval_vector_rows" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING (exists (
          select 1
          from "simulation_scenario_approval_revisions"
          where "simulation_scenario_approval_revisions"."id" = "simulation_scenario_approval_vector_rows"."approval_revision_id"
            and "simulation_scenario_approval_revisions"."owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid
        ));--> statement-breakpoint
GRANT SELECT ON TABLE "holding_onboarding_evidence" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "holding_state_corrections" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "simulation_scenario_approval_lifecycle_events" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "simulation_scenario_approval_revisions" TO "varda_tenant_app";--> statement-breakpoint
GRANT SELECT ON TABLE "simulation_scenario_approval_vector_rows" TO "varda_tenant_app";
