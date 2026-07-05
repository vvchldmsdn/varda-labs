CREATE TABLE "global_market_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"date" date NOT NULL,
	"factor_key" varchar(100) NOT NULL,
	"factor_family" varchar(100) NOT NULL,
	"factor_name" text NOT NULL,
	"frequency" varchar(50) NOT NULL,
	"source" varchar(100) NOT NULL,
	"source_series_id" varchar(150) NOT NULL,
	"benchmark_key" varchar(100),
	"country_code" varchar(10) NOT NULL,
	"region" varchar(50) NOT NULL,
	"related_currency" varchar(10) NOT NULL,
	"tenor" varchar(50) NOT NULL,
	"description" text,
	"derived_metrics_json" jsonb NOT NULL,
	"is_preliminary" boolean DEFAULT false NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"value" numeric(28, 12) NOT NULL,
	"prev_value" numeric(28, 12) NOT NULL,
	"change_pct" numeric(20, 8),
	"change_1m_pct" numeric(20, 8),
	"change_3m_pct" numeric(20, 8),
	"change_6m_pct" numeric(20, 8),
	"change_speed_20d" numeric(20, 8),
	"percentile_1y" numeric(20, 8) NOT NULL,
	"volatility_20d_pct" numeric(20, 8) NOT NULL,
	"volatility_60d_pct" numeric(20, 8) NOT NULL,
	"carry_spread_value" numeric(28, 12),
	"period_end_date" date NOT NULL,
	"release_date" date NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_regime_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legacy_base44_id" varchar(24),
	"date" date NOT NULL,
	"account" varchar(50) NOT NULL,
	"account_id" uuid,
	"label" varchar(100) NOT NULL,
	"description" text,
	"drivers_json" jsonb NOT NULL,
	"is_sample" boolean DEFAULT false NOT NULL,
	"macro_stress_score" numeric(20, 6),
	"regime_score" numeric(20, 6),
	"news_sentiment_score" numeric(20, 6),
	"avg_correlation" numeric(20, 6),
	"enb" numeric(20, 6),
	"portfolio_volatility" numeric(20, 6),
	"yield_curve" numeric(20, 6),
	"rate_level" numeric(20, 6),
	"stress_badge_count" integer,
	"base44_created_at" timestamp with time zone,
	"base44_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "global_market_factors_legacy_base44_id_unique" ON "global_market_factors" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE INDEX "global_market_factors_factor_date_idx" ON "global_market_factors" USING btree ("factor_key","date");--> statement-breakpoint
CREATE INDEX "global_market_factors_date_idx" ON "global_market_factors" USING btree ("date");--> statement-breakpoint
CREATE INDEX "global_market_factors_family_date_idx" ON "global_market_factors" USING btree ("factor_family","date");--> statement-breakpoint
CREATE UNIQUE INDEX "market_regime_daily_legacy_base44_id_unique" ON "market_regime_daily" USING btree ("legacy_base44_id");--> statement-breakpoint
CREATE INDEX "market_regime_daily_date_account_idx" ON "market_regime_daily" USING btree ("date","account");--> statement-breakpoint
CREATE INDEX "market_regime_daily_account_date_idx" ON "market_regime_daily" USING btree ("account","date");