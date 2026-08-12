CREATE TABLE "holding_onboarding_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"quantity" numeric(20, 6) NOT NULL,
	"average_cost" numeric(20, 4) NOT NULL,
	"current_price" numeric(20, 4) NOT NULL,
	"reported_return_pct" numeric(20, 6),
	"currency" varchar(10) NOT NULL,
	"price_source" varchar(100) NOT NULL,
	"price_as_of" timestamp with time zone,
	"policy_version" varchar(100) DEFAULT 'holding_onboarding_v1' NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holding_onboarding_evidence_quantity_check" CHECK ("holding_onboarding_evidence"."quantity" > 0),
	CONSTRAINT "holding_onboarding_evidence_average_cost_check" CHECK ("holding_onboarding_evidence"."average_cost" > 0),
	CONSTRAINT "holding_onboarding_evidence_current_price_check" CHECK ("holding_onboarding_evidence"."current_price" > 0),
	CONSTRAINT "holding_onboarding_evidence_reported_return_check" CHECK ("holding_onboarding_evidence"."reported_return_pct" is null or "holding_onboarding_evidence"."reported_return_pct" > -100),
	CONSTRAINT "holding_onboarding_evidence_currency_check" CHECK ("holding_onboarding_evidence"."currency" = upper(btrim("holding_onboarding_evidence"."currency")) and char_length("holding_onboarding_evidence"."currency") > 0),
	CONSTRAINT "holding_onboarding_evidence_price_source_check" CHECK ("holding_onboarding_evidence"."price_source" = btrim("holding_onboarding_evidence"."price_source") and char_length("holding_onboarding_evidence"."price_source") > 0),
	CONSTRAINT "holding_onboarding_evidence_policy_version_check" CHECK ("holding_onboarding_evidence"."policy_version" = 'holding_onboarding_v1')
);
--> statement-breakpoint
ALTER TABLE "holding_onboarding_evidence" ADD CONSTRAINT "holding_onboarding_evidence_owner_user_fk" FOREIGN KEY ("canonical_owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_onboarding_evidence" ADD CONSTRAINT "holding_onboarding_evidence_asset_owner_fk" FOREIGN KEY ("asset_id","canonical_owner_user_id") REFERENCES "public"."assets"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_onboarding_evidence" ADD CONSTRAINT "holding_onboarding_evidence_account_owner_fk" FOREIGN KEY ("account_id","canonical_owner_user_id") REFERENCES "public"."accounts"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_onboarding_evidence" ADD CONSTRAINT "holding_onboarding_evidence_asset_account_fk" FOREIGN KEY ("asset_id","account_id") REFERENCES "public"."assets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holding_onboarding_evidence_asset_unique" ON "holding_onboarding_evidence" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "holding_onboarding_evidence_owner_user_id_idx" ON "holding_onboarding_evidence" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "holding_onboarding_evidence_account_id_idx" ON "holding_onboarding_evidence" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_owner_account_instrument_unique" ON "assets" USING btree ("canonical_owner_user_id","account_id",lower(btrim("market")),upper(btrim("currency")),upper(btrim("ticker"))) WHERE "assets"."canonical_owner_user_id" is not null and "assets"."account_id" is not null and "assets"."ticker" is not null;