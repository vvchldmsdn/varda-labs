CREATE TABLE "live_price_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" varchar(50) NOT NULL,
	"market" varchar(20) NOT NULL,
	"currency" varchar(10) NOT NULL,
	"provider" varchar(100) NOT NULL,
	"source" varchar(100) NOT NULL,
	"quote_type" varchar(50) NOT NULL,
	"status" varchar(50) NOT NULL,
	"error" text,
	"price" numeric(28, 12) NOT NULL,
	"price_as_of" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "live_price_quotes_market_ticker_provider_unique" ON "live_price_quotes" USING btree ("market","ticker","provider");--> statement-breakpoint
CREATE INDEX "live_price_quotes_ticker_idx" ON "live_price_quotes" USING btree ("ticker");--> statement-breakpoint
CREATE INDEX "live_price_quotes_fetched_at_idx" ON "live_price_quotes" USING btree ("fetched_at");