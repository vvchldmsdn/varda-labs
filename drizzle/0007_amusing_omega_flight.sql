CREATE TABLE "asset_price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"date" date NOT NULL,
	"ticker" varchar(50) NOT NULL,
	"asset_id" uuid,
	"market" varchar(20) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"close_price" numeric(28, 12) NOT NULL,
	"adjusted_close_price" numeric(28, 12) NOT NULL,
	"close_price_krw" numeric(28, 12),
	"fx_rate" numeric(20, 6),
	"source" varchar(100),
	"is_sample" boolean DEFAULT false NOT NULL,
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"date" date NOT NULL,
	"benchmark_ticker" varchar(50) NOT NULL,
	"benchmark_name" varchar(255) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"close_price" numeric(28, 12) NOT NULL,
	"normalized_index_value" numeric(28, 12) NOT NULL,
	"fx_rate" numeric(20, 6),
	"source" varchar(100),
	"is_sample" boolean DEFAULT false NOT NULL,
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "asset_price_snapshots_legacy_base44_id_unique" ON "asset_price_snapshots" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE INDEX "asset_price_snapshots_ticker_date_idx" ON "asset_price_snapshots" USING btree ("ticker","date");--> statement-breakpoint
CREATE INDEX "asset_price_snapshots_date_idx" ON "asset_price_snapshots" USING btree ("date");--> statement-breakpoint
CREATE INDEX "asset_price_snapshots_asset_date_idx" ON "asset_price_snapshots" USING btree ("asset_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_snapshots_legacy_base44_id_unique" ON "benchmark_snapshots" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE INDEX "benchmark_snapshots_ticker_date_idx" ON "benchmark_snapshots" USING btree ("benchmark_ticker","date");--> statement-breakpoint
CREATE INDEX "benchmark_snapshots_date_idx" ON "benchmark_snapshots" USING btree ("date");