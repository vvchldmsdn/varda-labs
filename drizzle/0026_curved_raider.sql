CREATE TABLE "portfolio_target_policy_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"approval_revision_id" uuid NOT NULL,
	"event_sequence" integer NOT NULL,
	"audit_version" varchar(64) NOT NULL,
	"transition_kind" varchar(32) NOT NULL,
	"previous_status" varchar(20),
	"resulting_status" varchar(20) NOT NULL,
	"transitioned_at" timestamp with time zone NOT NULL,
	"replacement_revision_id" uuid,
	CONSTRAINT "portfolio_target_events_sequence_check" CHECK ("portfolio_target_policy_lifecycle_events"."event_sequence" in (1, 2)),
	CONSTRAINT "portfolio_target_events_audit_version_check" CHECK ("portfolio_target_policy_lifecycle_events"."audit_version" = 'portfolio_target_policy_audit_v1'),
	CONSTRAINT "portfolio_target_events_transition_shape_check" CHECK (("portfolio_target_policy_lifecycle_events"."event_sequence" = 1 and "portfolio_target_policy_lifecycle_events"."transition_kind" = 'explicit_approval' and "portfolio_target_policy_lifecycle_events"."previous_status" is null and "portfolio_target_policy_lifecycle_events"."resulting_status" = 'approved' and "portfolio_target_policy_lifecycle_events"."replacement_revision_id" is null) or ("portfolio_target_policy_lifecycle_events"."event_sequence" = 2 and "portfolio_target_policy_lifecycle_events"."transition_kind" = 'revocation' and "portfolio_target_policy_lifecycle_events"."previous_status" = 'approved' and "portfolio_target_policy_lifecycle_events"."resulting_status" = 'revoked' and "portfolio_target_policy_lifecycle_events"."replacement_revision_id" is null) or ("portfolio_target_policy_lifecycle_events"."event_sequence" = 2 and "portfolio_target_policy_lifecycle_events"."transition_kind" = 'supersession' and "portfolio_target_policy_lifecycle_events"."previous_status" = 'approved' and "portfolio_target_policy_lifecycle_events"."resulting_status" = 'superseded' and "portfolio_target_policy_lifecycle_events"."replacement_revision_id" is not null and "portfolio_target_policy_lifecycle_events"."replacement_revision_id" <> "portfolio_target_policy_lifecycle_events"."approval_revision_id"))
);
--> statement-breakpoint
CREATE TABLE "portfolio_target_policy_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"scope_kind" varchar(24) NOT NULL,
	"scope_account_id" uuid,
	"scope_portfolio_group_id" uuid,
	"policy_version" varchar(100) NOT NULL,
	"approval_revision" integer NOT NULL,
	"effective_service_date" date NOT NULL,
	"universe_hash" varchar(71) NOT NULL,
	"vector_hash" varchar(71) NOT NULL,
	"authority_source" varchar(64) NOT NULL,
	"lifecycle_status" varchar(20) NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"terminal_at" timestamp with time zone,
	CONSTRAINT "portfolio_target_revisions_scope_kind_check" CHECK ("portfolio_target_policy_revisions"."scope_kind" in ('all', 'account', 'portfolio_group')),
	CONSTRAINT "portfolio_target_revisions_scope_shape_check" CHECK (("portfolio_target_policy_revisions"."scope_kind" = 'all' and "portfolio_target_policy_revisions"."scope_account_id" is null and "portfolio_target_policy_revisions"."scope_portfolio_group_id" is null) or ("portfolio_target_policy_revisions"."scope_kind" = 'account' and "portfolio_target_policy_revisions"."scope_account_id" is not null and "portfolio_target_policy_revisions"."scope_portfolio_group_id" is null) or ("portfolio_target_policy_revisions"."scope_kind" = 'portfolio_group' and "portfolio_target_policy_revisions"."scope_account_id" is null and "portfolio_target_policy_revisions"."scope_portfolio_group_id" is not null)),
	CONSTRAINT "portfolio_target_revisions_policy_version_check" CHECK ("portfolio_target_policy_revisions"."policy_version" = 'portfolio_target_policy_v1'),
	CONSTRAINT "portfolio_target_revisions_revision_check" CHECK ("portfolio_target_policy_revisions"."approval_revision" > 0),
	CONSTRAINT "portfolio_target_revisions_universe_hash_check" CHECK ("portfolio_target_policy_revisions"."universe_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "portfolio_target_revisions_vector_hash_check" CHECK ("portfolio_target_policy_revisions"."vector_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "portfolio_target_revisions_authority_check" CHECK ("portfolio_target_policy_revisions"."authority_source" = 'session_user_explicit_v1'),
	CONSTRAINT "portfolio_target_revisions_status_check" CHECK ("portfolio_target_policy_revisions"."lifecycle_status" in ('approved', 'revoked', 'superseded')),
	CONSTRAINT "portfolio_target_revisions_terminal_state_check" CHECK (("portfolio_target_policy_revisions"."lifecycle_status" = 'approved' and "portfolio_target_policy_revisions"."terminal_at" is null) or ("portfolio_target_policy_revisions"."lifecycle_status" in ('revoked', 'superseded') and "portfolio_target_policy_revisions"."terminal_at" is not null and "portfolio_target_policy_revisions"."terminal_at" >= "portfolio_target_policy_revisions"."approved_at"))
);
--> statement-breakpoint
CREATE TABLE "portfolio_target_policy_rows" (
	"approval_revision_id" uuid NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"asset_name" varchar(255) NOT NULL,
	"market" varchar(20) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"ticker" varchar(50),
	"buyability" varchar(32) NOT NULL,
	"target_weight_bps" integer NOT NULL,
	CONSTRAINT "portfolio_target_policy_rows_pk" PRIMARY KEY("approval_revision_id","asset_id"),
	CONSTRAINT "portfolio_target_rows_asset_name_check" CHECK ("portfolio_target_policy_rows"."asset_name" = btrim("portfolio_target_policy_rows"."asset_name") and char_length("portfolio_target_policy_rows"."asset_name") > 0),
	CONSTRAINT "portfolio_target_rows_market_check" CHECK ("portfolio_target_policy_rows"."market" = lower(btrim("portfolio_target_policy_rows"."market")) and char_length("portfolio_target_policy_rows"."market") > 0),
	CONSTRAINT "portfolio_target_rows_currency_check" CHECK ("portfolio_target_policy_rows"."currency" = upper(btrim("portfolio_target_policy_rows"."currency")) and char_length("portfolio_target_policy_rows"."currency") > 0),
	CONSTRAINT "portfolio_target_rows_ticker_check" CHECK ("portfolio_target_policy_rows"."ticker" is null or ("portfolio_target_policy_rows"."ticker" = upper(btrim("portfolio_target_policy_rows"."ticker")) and char_length("portfolio_target_policy_rows"."ticker") > 0)),
	CONSTRAINT "portfolio_target_rows_buyability_check" CHECK ("portfolio_target_policy_rows"."buyability" in ('buyable', 'not_buyable', 'tickerless', 'unsupported_market', 'unsupported_currency')),
	CONSTRAINT "portfolio_target_rows_weight_check" CHECK ("portfolio_target_policy_rows"."target_weight_bps" between 0 and 10000),
	CONSTRAINT "portfolio_target_rows_positive_buyability_check" CHECK ("portfolio_target_policy_rows"."target_weight_bps" = 0 or "portfolio_target_policy_rows"."buyability" = 'buyable')
);
--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_lifecycle_events" ADD CONSTRAINT "portfolio_target_events_revision_owner_fk" FOREIGN KEY ("approval_revision_id","canonical_owner_user_id") REFERENCES "public"."portfolio_target_policy_revisions"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_lifecycle_events" ADD CONSTRAINT "portfolio_target_events_replacement_owner_fk" FOREIGN KEY ("replacement_revision_id","canonical_owner_user_id") REFERENCES "public"."portfolio_target_policy_revisions"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_revisions" ADD CONSTRAINT "portfolio_target_revisions_owner_user_fk" FOREIGN KEY ("canonical_owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_revisions" ADD CONSTRAINT "portfolio_target_revisions_account_owner_fk" FOREIGN KEY ("scope_account_id","canonical_owner_user_id") REFERENCES "public"."accounts"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_revisions" ADD CONSTRAINT "portfolio_target_revisions_group_owner_fk" FOREIGN KEY ("scope_portfolio_group_id","canonical_owner_user_id") REFERENCES "public"."portfolio_groups"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_rows" ADD CONSTRAINT "portfolio_target_rows_revision_owner_fk" FOREIGN KEY ("approval_revision_id","canonical_owner_user_id") REFERENCES "public"."portfolio_target_policy_revisions"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_rows" ADD CONSTRAINT "portfolio_target_rows_account_owner_fk" FOREIGN KEY ("account_id","canonical_owner_user_id") REFERENCES "public"."accounts"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_rows" ADD CONSTRAINT "portfolio_target_rows_asset_owner_fk" FOREIGN KEY ("asset_id","canonical_owner_user_id") REFERENCES "public"."assets"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_target_policy_rows" ADD CONSTRAINT "portfolio_target_rows_asset_account_fk" FOREIGN KEY ("asset_id","account_id") REFERENCES "public"."assets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_target_events_revision_sequence_unique" ON "portfolio_target_policy_lifecycle_events" USING btree ("approval_revision_id","event_sequence");--> statement-breakpoint
CREATE INDEX "portfolio_target_events_owner_idx" ON "portfolio_target_policy_lifecycle_events" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "portfolio_target_events_replacement_idx" ON "portfolio_target_policy_lifecycle_events" USING btree ("replacement_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_target_revisions_id_owner_unique" ON "portfolio_target_policy_revisions" USING btree ("id","canonical_owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_target_revisions_all_revision_unique" ON "portfolio_target_policy_revisions" USING btree ("canonical_owner_user_id","approval_revision") WHERE "portfolio_target_policy_revisions"."scope_kind" = 'all';--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_target_revisions_account_revision_unique" ON "portfolio_target_policy_revisions" USING btree ("canonical_owner_user_id","scope_account_id","approval_revision") WHERE "portfolio_target_policy_revisions"."scope_kind" = 'account';--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_target_revisions_group_revision_unique" ON "portfolio_target_policy_revisions" USING btree ("canonical_owner_user_id","scope_portfolio_group_id","approval_revision") WHERE "portfolio_target_policy_revisions"."scope_kind" = 'portfolio_group';--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_target_current_all_unique" ON "portfolio_target_policy_revisions" USING btree ("canonical_owner_user_id") WHERE "portfolio_target_policy_revisions"."scope_kind" = 'all' and "portfolio_target_policy_revisions"."lifecycle_status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_target_current_account_unique" ON "portfolio_target_policy_revisions" USING btree ("canonical_owner_user_id","scope_account_id") WHERE "portfolio_target_policy_revisions"."scope_kind" = 'account' and "portfolio_target_policy_revisions"."lifecycle_status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_target_current_group_unique" ON "portfolio_target_policy_revisions" USING btree ("canonical_owner_user_id","scope_portfolio_group_id") WHERE "portfolio_target_policy_revisions"."scope_kind" = 'portfolio_group' and "portfolio_target_policy_revisions"."lifecycle_status" = 'approved';--> statement-breakpoint
CREATE INDEX "portfolio_target_rows_owner_idx" ON "portfolio_target_policy_rows" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "portfolio_target_rows_account_idx" ON "portfolio_target_policy_rows" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "portfolio_target_rows_asset_idx" ON "portfolio_target_policy_rows" USING btree ("asset_id");