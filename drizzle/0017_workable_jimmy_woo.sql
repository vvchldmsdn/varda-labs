CREATE TABLE "simulation_scenario_approval_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_revision_id" uuid NOT NULL,
	"event_sequence" integer NOT NULL,
	"audit_version" varchar(50) NOT NULL,
	"transition_kind" varchar(32) NOT NULL,
	"previous_status" varchar(20),
	"resulting_status" varchar(20) NOT NULL,
	"transitioned_at" timestamp with time zone NOT NULL,
	"replacement_revision_id" uuid,
	CONSTRAINT "sim_scenario_approval_events_sequence_check" CHECK ("simulation_scenario_approval_lifecycle_events"."event_sequence" in (1, 2)),
	CONSTRAINT "sim_scenario_approval_events_audit_version_check" CHECK ("simulation_scenario_approval_lifecycle_events"."audit_version" = 'scenario_vector_approval_audit_v1'),
	CONSTRAINT "sim_scenario_approval_events_transition_shape_check" CHECK (("simulation_scenario_approval_lifecycle_events"."event_sequence" = 1 and "simulation_scenario_approval_lifecycle_events"."transition_kind" = 'explicit_approval' and "simulation_scenario_approval_lifecycle_events"."previous_status" is null and "simulation_scenario_approval_lifecycle_events"."resulting_status" = 'approved' and "simulation_scenario_approval_lifecycle_events"."replacement_revision_id" is null) or ("simulation_scenario_approval_lifecycle_events"."event_sequence" = 2 and "simulation_scenario_approval_lifecycle_events"."transition_kind" = 'revocation' and "simulation_scenario_approval_lifecycle_events"."previous_status" = 'approved' and "simulation_scenario_approval_lifecycle_events"."resulting_status" = 'revoked' and "simulation_scenario_approval_lifecycle_events"."replacement_revision_id" is null) or ("simulation_scenario_approval_lifecycle_events"."event_sequence" = 2 and "simulation_scenario_approval_lifecycle_events"."transition_kind" = 'supersession' and "simulation_scenario_approval_lifecycle_events"."previous_status" = 'approved' and "simulation_scenario_approval_lifecycle_events"."resulting_status" = 'superseded' and "simulation_scenario_approval_lifecycle_events"."replacement_revision_id" is not null and "simulation_scenario_approval_lifecycle_events"."replacement_revision_id" <> "simulation_scenario_approval_lifecycle_events"."approval_revision_id"))
);
--> statement-breakpoint
CREATE TABLE "simulation_scenario_approval_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"portfolio_path_policy_id" varchar(100) NOT NULL,
	"gate0_approval_commit" varchar(40) NOT NULL,
	"scenario_id" varchar(100) NOT NULL,
	"scenario_version" varchar(100) NOT NULL,
	"approval_revision" integer NOT NULL,
	"scenario_vector_hash" varchar(71) NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"lifecycle_status" varchar(20) NOT NULL,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "sim_scenario_approval_revisions_policy_id_check" CHECK ("simulation_scenario_approval_revisions"."portfolio_path_policy_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
	CONSTRAINT "sim_scenario_approval_revisions_gate0_commit_check" CHECK ("simulation_scenario_approval_revisions"."gate0_approval_commit" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "sim_scenario_approval_revisions_scenario_id_check" CHECK ("simulation_scenario_approval_revisions"."scenario_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
	CONSTRAINT "sim_scenario_approval_revisions_scenario_version_check" CHECK ("simulation_scenario_approval_revisions"."scenario_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
	CONSTRAINT "sim_scenario_approval_revisions_revision_check" CHECK ("simulation_scenario_approval_revisions"."approval_revision" > 0),
	CONSTRAINT "sim_scenario_approval_revisions_vector_hash_check" CHECK ("simulation_scenario_approval_revisions"."scenario_vector_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "sim_scenario_approval_revisions_lifecycle_status_check" CHECK ("simulation_scenario_approval_revisions"."lifecycle_status" in ('approved', 'revoked', 'superseded')),
	CONSTRAINT "sim_scenario_approval_revisions_terminal_state_check" CHECK (("simulation_scenario_approval_revisions"."lifecycle_status" = 'approved' and "simulation_scenario_approval_revisions"."terminal_at" is null) or ("simulation_scenario_approval_revisions"."lifecycle_status" in ('revoked', 'superseded') and "simulation_scenario_approval_revisions"."terminal_at" is not null and "simulation_scenario_approval_revisions"."terminal_at" >= "simulation_scenario_approval_revisions"."approved_at"))
);
--> statement-breakpoint
CREATE TABLE "simulation_scenario_approval_vector_rows" (
	"approval_revision_id" uuid NOT NULL,
	"market" varchar(20) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"ticker" varchar(50) NOT NULL,
	"weight_bps" integer NOT NULL,
	CONSTRAINT "sim_scenario_approval_vector_rows_pk" PRIMARY KEY("approval_revision_id","market","currency","ticker"),
	CONSTRAINT "sim_scenario_approval_vector_rows_market_check" CHECK ("simulation_scenario_approval_vector_rows"."market" = lower(btrim("simulation_scenario_approval_vector_rows"."market")) and char_length("simulation_scenario_approval_vector_rows"."market") > 0),
	CONSTRAINT "sim_scenario_approval_vector_rows_currency_check" CHECK ("simulation_scenario_approval_vector_rows"."currency" = upper(btrim("simulation_scenario_approval_vector_rows"."currency")) and char_length("simulation_scenario_approval_vector_rows"."currency") > 0),
	CONSTRAINT "sim_scenario_approval_vector_rows_ticker_check" CHECK ("simulation_scenario_approval_vector_rows"."ticker" = upper(btrim("simulation_scenario_approval_vector_rows"."ticker")) and char_length("simulation_scenario_approval_vector_rows"."ticker") > 0),
	CONSTRAINT "sim_scenario_approval_vector_rows_weight_check" CHECK ("simulation_scenario_approval_vector_rows"."weight_bps" between 0 and 10000)
);
--> statement-breakpoint
ALTER TABLE "simulation_scenario_approval_lifecycle_events" ADD CONSTRAINT "sim_scenario_approval_events_revision_fk" FOREIGN KEY ("approval_revision_id") REFERENCES "public"."simulation_scenario_approval_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_scenario_approval_lifecycle_events" ADD CONSTRAINT "sim_scenario_approval_events_replacement_fk" FOREIGN KEY ("replacement_revision_id") REFERENCES "public"."simulation_scenario_approval_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_scenario_approval_revisions" ADD CONSTRAINT "sim_scenario_approval_revisions_owner_user_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulation_scenario_approval_vector_rows" ADD CONSTRAINT "sim_scenario_approval_vector_rows_revision_fk" FOREIGN KEY ("approval_revision_id") REFERENCES "public"."simulation_scenario_approval_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sim_scenario_approval_events_revision_sequence_unique" ON "simulation_scenario_approval_lifecycle_events" USING btree ("approval_revision_id","event_sequence");--> statement-breakpoint
CREATE INDEX "sim_scenario_approval_events_replacement_idx" ON "simulation_scenario_approval_lifecycle_events" USING btree ("replacement_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_scenario_approval_revisions_identity_revision_unique" ON "simulation_scenario_approval_revisions" USING btree ("owner_user_id","portfolio_path_policy_id","gate0_approval_commit","scenario_id","scenario_version","approval_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "sim_scenario_approval_revisions_current_unique" ON "simulation_scenario_approval_revisions" USING btree ("owner_user_id","portfolio_path_policy_id","gate0_approval_commit","scenario_id","scenario_version") WHERE "simulation_scenario_approval_revisions"."lifecycle_status" = 'approved';