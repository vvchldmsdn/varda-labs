CREATE TABLE "target_policy_approval_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"approval_revision_id" uuid NOT NULL,
	"event_sequence" integer NOT NULL,
	"audit_version" varchar(50) NOT NULL,
	"transition_kind" varchar(32) NOT NULL,
	"previous_status" varchar(20),
	"resulting_status" varchar(20) NOT NULL,
	"transitioned_at" timestamp with time zone NOT NULL,
	"replacement_revision_id" uuid,
	CONSTRAINT "target_policy_events_sequence_check" CHECK ("target_policy_approval_lifecycle_events"."event_sequence" in (1, 2)),
	CONSTRAINT "target_policy_events_audit_version_check" CHECK ("target_policy_approval_lifecycle_events"."audit_version" = 'target_policy_approval_audit_v1'),
	CONSTRAINT "target_policy_events_transition_shape_check" CHECK (("target_policy_approval_lifecycle_events"."event_sequence" = 1 and "target_policy_approval_lifecycle_events"."transition_kind" = 'explicit_approval' and "target_policy_approval_lifecycle_events"."previous_status" is null and "target_policy_approval_lifecycle_events"."resulting_status" = 'approved' and "target_policy_approval_lifecycle_events"."replacement_revision_id" is null) or ("target_policy_approval_lifecycle_events"."event_sequence" = 2 and "target_policy_approval_lifecycle_events"."transition_kind" = 'revocation' and "target_policy_approval_lifecycle_events"."previous_status" = 'approved' and "target_policy_approval_lifecycle_events"."resulting_status" = 'revoked' and "target_policy_approval_lifecycle_events"."replacement_revision_id" is null) or ("target_policy_approval_lifecycle_events"."event_sequence" = 2 and "target_policy_approval_lifecycle_events"."transition_kind" = 'supersession' and "target_policy_approval_lifecycle_events"."previous_status" = 'approved' and "target_policy_approval_lifecycle_events"."resulting_status" = 'superseded' and "target_policy_approval_lifecycle_events"."replacement_revision_id" is not null and "target_policy_approval_lifecycle_events"."replacement_revision_id" <> "target_policy_approval_lifecycle_events"."approval_revision_id"))
);
--> statement-breakpoint
CREATE TABLE "target_policy_approval_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"policy_id" varchar(100) NOT NULL,
	"policy_version" varchar(100) NOT NULL,
	"approval_revision" integer NOT NULL,
	"effective_service_date" date NOT NULL,
	"universe_hash" varchar(71) NOT NULL,
	"vector_hash" varchar(71) NOT NULL,
	"approval_evidence_ref" varchar(200) NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"lifecycle_status" varchar(20) NOT NULL,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "target_policy_revisions_policy_id_check" CHECK ("target_policy_approval_revisions"."policy_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
	CONSTRAINT "target_policy_revisions_version_check" CHECK ("target_policy_approval_revisions"."policy_version" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
	CONSTRAINT "target_policy_revisions_revision_check" CHECK ("target_policy_approval_revisions"."approval_revision" > 0),
	CONSTRAINT "target_policy_revisions_universe_hash_check" CHECK ("target_policy_approval_revisions"."universe_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "target_policy_revisions_vector_hash_check" CHECK ("target_policy_approval_revisions"."vector_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "target_policy_revisions_evidence_ref_check" CHECK ("target_policy_approval_revisions"."approval_evidence_ref" ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
	CONSTRAINT "target_policy_revisions_status_check" CHECK ("target_policy_approval_revisions"."lifecycle_status" in ('approved', 'revoked', 'superseded')),
	CONSTRAINT "target_policy_revisions_terminal_state_check" CHECK (("target_policy_approval_revisions"."lifecycle_status" = 'approved' and "target_policy_approval_revisions"."terminal_at" is null) or ("target_policy_approval_revisions"."lifecycle_status" in ('revoked', 'superseded') and "target_policy_approval_revisions"."terminal_at" is not null and "target_policy_approval_revisions"."terminal_at" >= "target_policy_approval_revisions"."approved_at"))
);
--> statement-breakpoint
CREATE TABLE "target_policy_approval_vector_rows" (
	"approval_revision_id" uuid NOT NULL,
	"market" varchar(20) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"ticker" varchar(50) NOT NULL,
	"target_weight_bps" integer NOT NULL,
	CONSTRAINT "target_policy_vector_rows_pk" PRIMARY KEY("approval_revision_id","market","currency","ticker"),
	CONSTRAINT "target_policy_vector_rows_market_check" CHECK ("target_policy_approval_vector_rows"."market" = lower(btrim("target_policy_approval_vector_rows"."market")) and char_length("target_policy_approval_vector_rows"."market") > 0),
	CONSTRAINT "target_policy_vector_rows_currency_check" CHECK ("target_policy_approval_vector_rows"."currency" = upper(btrim("target_policy_approval_vector_rows"."currency")) and char_length("target_policy_approval_vector_rows"."currency") > 0),
	CONSTRAINT "target_policy_vector_rows_ticker_check" CHECK ("target_policy_approval_vector_rows"."ticker" = upper(btrim("target_policy_approval_vector_rows"."ticker")) and char_length("target_policy_approval_vector_rows"."ticker") > 0),
	CONSTRAINT "target_policy_vector_rows_weight_check" CHECK ("target_policy_approval_vector_rows"."target_weight_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_id_canonical_owner_unique" ON "accounts" USING btree ("id","canonical_owner_user_id");--> statement-breakpoint
ALTER TABLE "target_policy_approval_lifecycle_events" ADD CONSTRAINT "target_policy_events_revision_fk" FOREIGN KEY ("approval_revision_id") REFERENCES "public"."target_policy_approval_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_policy_approval_lifecycle_events" ADD CONSTRAINT "target_policy_events_replacement_fk" FOREIGN KEY ("replacement_revision_id") REFERENCES "public"."target_policy_approval_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_policy_approval_revisions" ADD CONSTRAINT "target_policy_revisions_owner_user_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_policy_approval_revisions" ADD CONSTRAINT "target_policy_revisions_account_owner_fk" FOREIGN KEY ("account_id","owner_user_id") REFERENCES "public"."accounts"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_policy_approval_vector_rows" ADD CONSTRAINT "target_policy_vector_rows_revision_fk" FOREIGN KEY ("approval_revision_id") REFERENCES "public"."target_policy_approval_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "target_policy_events_revision_sequence_unique" ON "target_policy_approval_lifecycle_events" USING btree ("approval_revision_id","event_sequence");--> statement-breakpoint
CREATE INDEX "target_policy_events_replacement_idx" ON "target_policy_approval_lifecycle_events" USING btree ("replacement_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "target_policy_revisions_identity_revision_unique" ON "target_policy_approval_revisions" USING btree ("owner_user_id","account_id","policy_id","policy_version","approval_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "target_policy_revisions_current_unique" ON "target_policy_approval_revisions" USING btree ("owner_user_id","account_id","policy_id") WHERE "target_policy_approval_revisions"."lifecycle_status" = 'approved';
