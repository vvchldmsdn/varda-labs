CREATE TABLE "market_collection_jobs" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"kind" varchar(10) NOT NULL,
	"ticker" varchar(50) NOT NULL,
	"market" varchar(20) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"start_date" date,
	"end_date" date,
	"status" varchar(10) DEFAULT 'pending' NOT NULL,
	"enqueued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_until" timestamp with time zone,
	"claim_token" uuid,
	"attempts" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_code" varchar(50),
	CONSTRAINT "market_collection_jobs_state_check" CHECK ("market_collection_jobs"."status" in ('pending','running','done','failed') and "market_collection_jobs"."attempts" >= 0 and "market_collection_jobs"."request_count" >= 1),
	CONSTRAINT "market_collection_jobs_identity_check" CHECK ("market_collection_jobs"."kind" in ('live','history','fx') and (("market_collection_jobs"."market"='korea' and "market_collection_jobs"."currency"='KRW') or ("market_collection_jobs"."market"='us' and "market_collection_jobs"."currency"='USD'))),
	CONSTRAINT "market_collection_jobs_dates_check" CHECK (("market_collection_jobs"."kind"='history' and "market_collection_jobs"."start_date" is not null and "market_collection_jobs"."end_date" is not null and "market_collection_jobs"."end_date" >= "market_collection_jobs"."start_date") or ("market_collection_jobs"."kind"<>'history' and "market_collection_jobs"."start_date" is null and "market_collection_jobs"."end_date" is null))
);
--> statement-breakpoint
ALTER TABLE "market_collection_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "market_provider_budgets" (
	"scope_hash" varchar(64) PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_requests" integer DEFAULT 0 NOT NULL,
	"next_allowed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"token_next_allowed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone DEFAULT now() NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"limited_count" integer DEFAULT 0 NOT NULL,
	"last_code" varchar(40),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "market_provider_budgets_counts_check" CHECK ("market_provider_budgets"."window_requests" >= 0 and "market_provider_budgets"."failure_count" >= 0 and "market_provider_budgets"."request_count" >= 0 and "market_provider_budgets"."limited_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "market_provider_budgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "market_collection_jobs_pending_idx" ON "market_collection_jobs" USING btree ("status","available_at","enqueued_at");