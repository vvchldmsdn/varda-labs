ALTER TABLE "asset_groups" ADD COLUMN "legacy_base44_id" varchar(24);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "legacy_base44_id" varchar(24);--> statement-breakpoint
CREATE UNIQUE INDEX "asset_groups_legacy_base44_id_unique" ON "asset_groups" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assets_legacy_base44_id_unique" ON "assets" USING btree ("legacy_base44_id");