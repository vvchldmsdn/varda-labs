-- Disabled-provider collection infrastructure. No operational jobs/settings are changed.
ALTER TABLE market_provider_budgets
  ADD COLUMN provider varchar(20) NOT NULL DEFAULT 'kis',
  ADD COLUMN window_credits integer NOT NULL DEFAULT 0,
  ADD COLUMN credit_count bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE market_provider_budgets ADD CONSTRAINT market_provider_budgets_credits_check
  CHECK (window_credits >= 0 AND credit_count >= 0 AND provider IN ('kis','twelve_data'));
--> statement-breakpoint
CREATE TABLE market_provider_reservations (
  scope_hash varchar(64) NOT NULL REFERENCES market_provider_budgets(scope_hash),
  reservation_id varchar(64) NOT NULL,
  http_requests integer NOT NULL,
  api_credits integer NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_hash, reservation_id),
  CONSTRAINT market_provider_reservations_counts_check CHECK (http_requests > 0 AND api_credits > 0)
);
--> statement-breakpoint
CREATE INDEX market_provider_reservations_age_idx ON market_provider_reservations(scope_hash, reserved_at);
--> statement-breakpoint
ALTER TABLE market_provider_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_provider_reservations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON market_provider_reservations FROM PUBLIC, varda_tenant_app;
