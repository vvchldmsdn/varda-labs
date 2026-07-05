CREATE TABLE "event_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"event_date" date NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"source" varchar(100),
	"recorded_at" timestamp with time zone,
	"rule_version" varchar(100),
	"account" varchar(50),
	"account_id" uuid,
	"asset_id" uuid,
	"legacy_asset_id" varchar(24) NOT NULL,
	"ticker" varchar(50),
	"asset_name" text NOT NULL,
	"group_id" uuid,
	"legacy_group_id" varchar(24),
	"group_name" text,
	"corrects_event_id" uuid,
	"legacy_corrects_event_id" varchar(24),
	"amount_krw" numeric(28, 8),
	"quantity_delta" numeric(28, 8),
	"price" numeric(28, 12),
	"fx_rate" numeric(20, 6),
	"before_value" text NOT NULL,
	"after_value" text NOT NULL,
	"memo" text,
	"description" text,
	"is_sample" boolean DEFAULT false NOT NULL,
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "event_ledger_entries_legacy_base44_id_unique" ON "event_ledger_entries" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE INDEX "event_ledger_entries_date_type_idx" ON "event_ledger_entries" USING btree ("event_date","event_type");--> statement-breakpoint
CREATE INDEX "event_ledger_entries_legacy_asset_id_idx" ON "event_ledger_entries" USING btree ("legacy_asset_id");--> statement-breakpoint
CREATE INDEX "event_ledger_entries_asset_date_idx" ON "event_ledger_entries" USING btree ("asset_id","event_date");--> statement-breakpoint
CREATE INDEX "event_ledger_entries_account_date_idx" ON "event_ledger_entries" USING btree ("account","event_date");--> statement-breakpoint
CREATE INDEX "event_ledger_entries_legacy_group_id_idx" ON "event_ledger_entries" USING btree ("legacy_group_id");