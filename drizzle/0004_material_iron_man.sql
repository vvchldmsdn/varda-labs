ALTER TABLE "assets" ADD COLUMN "ma_asset_class" varchar(50);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "ma_120" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "fractional_krw_value" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "fractional_avg_cost" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "monthly_contribution" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "contribution_day" integer;