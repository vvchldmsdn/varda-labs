CREATE TABLE "market_data_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" varchar(100) NOT NULL,
	"mode" varchar(50),
	"status" varchar(50) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"source" varchar(100),
	"requested_count" integer,
	"success_count" integer,
	"failed_count" integer,
	"skipped_count" integer,
	"metadata_json" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "price_source" varchar(100);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "price_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "price_as_of" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "price_quote_type" varchar(50);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "price_status" varchar(50);--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "price_error" text;--> statement-breakpoint
CREATE INDEX "market_data_sync_runs_job_started_idx" ON "market_data_sync_runs" USING btree ("job_type","started_at");--> statement-breakpoint
CREATE INDEX "market_data_sync_runs_status_started_idx" ON "market_data_sync_runs" USING btree ("status","started_at");