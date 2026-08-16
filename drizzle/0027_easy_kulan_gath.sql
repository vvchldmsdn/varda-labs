CREATE TABLE "holding_state_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"previous_quantity" numeric(20, 6) NOT NULL,
	"corrected_quantity" numeric(20, 6) NOT NULL,
	"previous_average_cost" numeric(20, 4),
	"corrected_average_cost" numeric(20, 4) NOT NULL,
	"previous_asset_updated_at" timestamp with time zone NOT NULL,
	"corrected_asset_updated_at" timestamp with time zone NOT NULL,
	"reason" text,
	"policy_version" varchar(100) DEFAULT 'holding_state_correction_v1' NOT NULL,
	"corrected_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holding_state_corrections_previous_quantity_check" CHECK ("holding_state_corrections"."previous_quantity" >= 0),
	CONSTRAINT "holding_state_corrections_corrected_quantity_check" CHECK ("holding_state_corrections"."corrected_quantity" > 0),
	CONSTRAINT "holding_state_corrections_previous_average_cost_check" CHECK ("holding_state_corrections"."previous_average_cost" is null or "holding_state_corrections"."previous_average_cost" >= 0),
	CONSTRAINT "holding_state_corrections_corrected_average_cost_check" CHECK ("holding_state_corrections"."corrected_average_cost" > 0),
	CONSTRAINT "holding_state_corrections_timestamp_order_check" CHECK ("holding_state_corrections"."corrected_asset_updated_at" >= "holding_state_corrections"."previous_asset_updated_at" and "holding_state_corrections"."corrected_at" = "holding_state_corrections"."corrected_asset_updated_at"),
	CONSTRAINT "holding_state_corrections_reason_check" CHECK ("holding_state_corrections"."reason" is null or ("holding_state_corrections"."reason" = btrim("holding_state_corrections"."reason") and char_length("holding_state_corrections"."reason") between 1 and 500)),
	CONSTRAINT "holding_state_corrections_policy_version_check" CHECK ("holding_state_corrections"."policy_version" = 'holding_state_correction_v1')
);
--> statement-breakpoint
ALTER TABLE "holding_state_corrections" ADD CONSTRAINT "holding_state_corrections_owner_user_fk" FOREIGN KEY ("canonical_owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_state_corrections" ADD CONSTRAINT "holding_state_corrections_asset_owner_fk" FOREIGN KEY ("asset_id","canonical_owner_user_id") REFERENCES "public"."assets"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_state_corrections" ADD CONSTRAINT "holding_state_corrections_account_owner_fk" FOREIGN KEY ("account_id","canonical_owner_user_id") REFERENCES "public"."accounts"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_state_corrections" ADD CONSTRAINT "holding_state_corrections_asset_account_fk" FOREIGN KEY ("asset_id","account_id") REFERENCES "public"."assets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holding_state_corrections_owner_user_id_idx" ON "holding_state_corrections" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "holding_state_corrections_asset_corrected_at_idx" ON "holding_state_corrections" USING btree ("asset_id","corrected_at");--> statement-breakpoint
CREATE INDEX "holding_state_corrections_account_corrected_at_idx" ON "holding_state_corrections" USING btree ("account_id","corrected_at");