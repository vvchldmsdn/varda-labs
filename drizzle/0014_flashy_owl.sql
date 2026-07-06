ALTER TABLE "daily_portfolio_snapshots" ADD COLUMN "source" varchar(100) DEFAULT 'base44_import' NOT NULL;--> statement-breakpoint
ALTER TABLE "daily_position_snapshots" ADD COLUMN "source" varchar(100) DEFAULT 'base44_import' NOT NULL;--> statement-breakpoint
UPDATE "daily_portfolio_snapshots"
SET "source" = 'varda_manual_daily_snapshot'
WHERE "legacy_base44_id" IS NULL
  AND coalesce("description", '') LIKE '%source=varda_manual_daily_snapshot%';--> statement-breakpoint
UPDATE "daily_position_snapshots"
SET "source" = 'varda_manual_daily_snapshot'
WHERE "legacy_base44_id" IS NULL
  AND coalesce("description", '') LIKE '%source=varda_manual_daily_snapshot%';--> statement-breakpoint
CREATE UNIQUE INDEX "daily_portfolio_snapshots_date_account_source_unique" ON "daily_portfolio_snapshots" USING btree ("snapshot_date","account","source");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_position_snapshots_date_account_asset_source_unique" ON "daily_position_snapshots" USING btree ("snapshot_date","account","asset_id","source") WHERE "daily_position_snapshots"."asset_id" is not null;
