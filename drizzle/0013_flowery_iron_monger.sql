DROP INDEX "asset_price_snapshots_ticker_date_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "asset_price_snapshots_ticker_date_unique" ON "asset_price_snapshots" USING btree ("ticker","date");