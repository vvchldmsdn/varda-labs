CREATE TABLE "app_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(20) DEFAULT 'provisioning' NOT NULL,
	"role" varchar(20) DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_users_status_check" CHECK ("app_users"."status" in ('provisioning', 'active', 'disabled')),
	CONSTRAINT "app_users_role_check" CHECK ("app_users"."role" in ('user', 'admin'))
);
--> statement-breakpoint
CREATE TABLE "auth_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_user_id" uuid NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_subject" varchar(255) NOT NULL,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_identities_status_check" CHECK ("auth_identities"."status" in ('active', 'disabled')),
	CONSTRAINT "auth_identities_provider_check" CHECK ("auth_identities"."provider" = lower(btrim("auth_identities"."provider")) and char_length("auth_identities"."provider") > 0),
	CONSTRAINT "auth_identities_provider_subject_check" CHECK ("auth_identities"."provider_subject" = btrim("auth_identities"."provider_subject") and char_length("auth_identities"."provider_subject") > 0),
	CONSTRAINT "auth_identities_disabled_state_check" CHECK (("auth_identities"."status" = 'active' and "auth_identities"."disabled_at" is null) or ("auth_identities"."status" = 'disabled' and "auth_identities"."disabled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "account_balance_snapshots" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_group_members" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "asset_groups" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "daily_portfolio_snapshots" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "daily_position_snapshots" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "event_ledger_entries" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "fixed_transactions" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "market_regime_daily" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "monthly_incomes" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "canonical_owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "auth_identities" ADD CONSTRAINT "auth_identities_app_user_id_app_users_id_fk" FOREIGN KEY ("app_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_provider_subject_unique" ON "auth_identities" USING btree ("provider","provider_subject");--> statement-breakpoint
CREATE INDEX "auth_identities_app_user_id_idx" ON "auth_identities" USING btree ("app_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_identities_active_app_user_provider_unique" ON "auth_identities" USING btree ("app_user_id","provider") WHERE "auth_identities"."status" = 'active';--> statement-breakpoint
CREATE INDEX "account_balance_snapshots_canonical_owner_user_id_idx" ON "account_balance_snapshots" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "accounts_canonical_owner_user_id_idx" ON "accounts" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "asset_group_members_canonical_owner_user_id_idx" ON "asset_group_members" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "asset_groups_canonical_owner_user_id_idx" ON "asset_groups" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "assets_canonical_owner_user_id_idx" ON "assets" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "daily_portfolio_snapshots_canonical_owner_user_id_idx" ON "daily_portfolio_snapshots" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "daily_position_snapshots_canonical_owner_user_id_idx" ON "daily_position_snapshots" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "event_ledger_entries_canonical_owner_user_id_idx" ON "event_ledger_entries" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "fixed_transactions_canonical_owner_user_id_idx" ON "fixed_transactions" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "goals_canonical_owner_user_id_idx" ON "goals" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "market_regime_daily_canonical_owner_user_id_idx" ON "market_regime_daily" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "monthly_incomes_canonical_owner_user_id_idx" ON "monthly_incomes" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "settings_canonical_owner_user_id_idx" ON "settings" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "transactions_canonical_owner_user_id_idx" ON "transactions" USING btree ("canonical_owner_user_id");