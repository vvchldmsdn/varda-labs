ALTER TABLE "asset_price_snapshots" ALTER COLUMN "adjusted_close_price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "adjusted_close_basis" varchar(50);--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "adjusted_close_provider" varchar(50);--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "adjusted_close_source" varchar(100);--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "adjusted_close_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "provider_symbol" varchar(100);--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "provider_exchange" varchar(50);--> statement-breakpoint
ALTER TABLE "asset_price_snapshots" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_price_snapshots_instrument_date_unique" ON "asset_price_snapshots" USING btree ("market","currency","ticker","date");