CREATE TABLE "holding_lifecycle_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_owner_user_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"event_type" varchar(20) NOT NULL,
	"previous_archived_at" timestamp with time zone,
	"resulting_archived_at" timestamp with time zone,
	"previous_asset_updated_at" timestamp with time zone NOT NULL,
	"resulting_asset_updated_at" timestamp with time zone NOT NULL,
	"reason" text,
	"policy_version" varchar(100) DEFAULT 'holding_lifecycle_v1' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holding_lifecycle_events_event_type_check" CHECK ("holding_lifecycle_events"."event_type" in ('archived', 'restored')),
	CONSTRAINT "holding_lifecycle_events_transition_shape_check" CHECK (("holding_lifecycle_events"."event_type" = 'archived' and "holding_lifecycle_events"."previous_archived_at" is null and "holding_lifecycle_events"."resulting_archived_at" is not null) or ("holding_lifecycle_events"."event_type" = 'restored' and "holding_lifecycle_events"."previous_archived_at" is not null and "holding_lifecycle_events"."resulting_archived_at" is null)),
	CONSTRAINT "holding_lifecycle_events_timestamp_order_check" CHECK ("holding_lifecycle_events"."resulting_asset_updated_at" >= "holding_lifecycle_events"."previous_asset_updated_at" and "holding_lifecycle_events"."occurred_at" = "holding_lifecycle_events"."resulting_asset_updated_at"),
	CONSTRAINT "holding_lifecycle_events_reason_check" CHECK ("holding_lifecycle_events"."reason" is null or ("holding_lifecycle_events"."reason" = btrim("holding_lifecycle_events"."reason") and char_length("holding_lifecycle_events"."reason") between 1 and 500)),
	CONSTRAINT "holding_lifecycle_events_policy_version_check" CHECK ("holding_lifecycle_events"."policy_version" = 'holding_lifecycle_v1')
);
--> statement-breakpoint
ALTER TABLE "holding_lifecycle_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "holding_lifecycle_events" ADD CONSTRAINT "holding_lifecycle_events_owner_user_fk" FOREIGN KEY ("canonical_owner_user_id") REFERENCES "public"."app_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_lifecycle_events" ADD CONSTRAINT "holding_lifecycle_events_asset_owner_fk" FOREIGN KEY ("asset_id","canonical_owner_user_id") REFERENCES "public"."assets"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_lifecycle_events" ADD CONSTRAINT "holding_lifecycle_events_account_owner_fk" FOREIGN KEY ("account_id","canonical_owner_user_id") REFERENCES "public"."accounts"("id","canonical_owner_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holding_lifecycle_events" ADD CONSTRAINT "holding_lifecycle_events_asset_account_fk" FOREIGN KEY ("asset_id","account_id") REFERENCES "public"."assets"("id","account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "holding_lifecycle_events_owner_user_id_idx" ON "holding_lifecycle_events" USING btree ("canonical_owner_user_id");--> statement-breakpoint
CREATE INDEX "holding_lifecycle_events_asset_occurred_at_idx" ON "holding_lifecycle_events" USING btree ("asset_id","occurred_at");--> statement-breakpoint
CREATE INDEX "holding_lifecycle_events_account_occurred_at_idx" ON "holding_lifecycle_events" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE POLICY "holding_lifecycle_events_tenant_select_v1" ON "holding_lifecycle_events" AS PERMISSIVE FOR SELECT TO "varda_tenant_app" USING ("holding_lifecycle_events"."canonical_owner_user_id" = nullif(current_setting('app.current_user_id', true), '')::uuid);