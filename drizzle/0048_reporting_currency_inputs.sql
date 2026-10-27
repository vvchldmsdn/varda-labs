-- Additive compatibility only. Existing JSON, holdings, transactions and RLS are untouched.
ALTER TABLE investment_plans DROP CONSTRAINT investment_plans_engine_check;
--> statement-breakpoint
ALTER TABLE investment_plans ADD CONSTRAINT investment_plans_engine_check CHECK (engine_version IN ('deficit_proportional_capped_v1', 'deficit_proportional_currency_v2'));
--> statement-breakpoint
ALTER TABLE portfolio_drafts DROP CONSTRAINT portfolio_drafts_engine_check;
--> statement-breakpoint
ALTER TABLE portfolio_drafts ADD CONSTRAINT portfolio_drafts_engine_check CHECK (engine_version IN ('amount_composition_v1', 'amount_composition_currency_v2'));
--> statement-breakpoint
ALTER TABLE fx_rates ADD COLUMN observed_at timestamptz, ADD COLUMN rate_kind varchar(30);
--> statement-breakpoint
ALTER TABLE fx_rates ADD CONSTRAINT fx_rates_observation_check CHECK (observed_at IS NULL OR (fetched_at IS NOT NULL AND observed_at <= fetched_at AND rate_kind IS NOT NULL AND rate_kind IN ('spot','daily_reference')));
