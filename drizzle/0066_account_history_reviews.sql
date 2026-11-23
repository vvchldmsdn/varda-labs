-- A reviewed historical slice is a separate estimate. It never mutates the ledger,
-- actual account observations, or the basis used to value other accounts.
CREATE TABLE account_history_reviews (
  canonical_owner_user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  evidence_hash varchar(64) NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  captured_revision integer NOT NULL CHECK (captured_revision >= 0),
  start_date date NOT NULL,
  end_date date NOT NULL,
  excluded_labels text[] NOT NULL,
  points jsonb NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, evidence_hash),
  FOREIGN KEY (account_id, canonical_owner_user_id)
    REFERENCES accounts(id, canonical_owner_user_id) ON DELETE CASCADE,
  CONSTRAINT account_history_reviews_dates_check CHECK (end_date >= start_date AND end_date - start_date < 366),
  CONSTRAINT account_history_reviews_excluded_labels_check CHECK (cardinality(excluded_labels) <= 100 AND array_position(excluded_labels, NULL) IS NULL),
  CONSTRAINT account_history_reviews_points_check CHECK (jsonb_typeof(points) = 'array' AND jsonb_array_length(points) = end_date - start_date + 1),
  CONSTRAINT account_history_reviews_evidence_check CHECK (jsonb_typeof(evidence) = 'object' AND evidence @> '{"version":1,"basis":"reviewed_holdings_excluding_cash","currency":"KRW"}'::jsonb)
);
--> statement-breakpoint
CREATE INDEX account_history_reviews_latest ON account_history_reviews (canonical_owner_user_id, account_id, created_at DESC);
--> statement-breakpoint
ALTER TABLE account_history_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY account_history_reviews_owner ON account_history_reviews FOR SELECT TO varda_tenant_app
  USING (canonical_owner_user_id = nullif(current_setting('app.current_user_id', true), '')::uuid);
--> statement-breakpoint
-- Position-level reconstruction evidence stays server-private. No application writes.
REVOKE ALL ON account_history_reviews FROM PUBLIC, varda_tenant_app;
--> statement-breakpoint
GRANT SELECT(canonical_owner_user_id, account_id, captured_revision, start_date, end_date,
  points, excluded_labels, created_at, evidence_hash) ON account_history_reviews TO varda_tenant_app;
--> statement-breakpoint
CREATE FUNCTION preserve_account_history_review() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM accounts
    WHERE id=OLD.account_id AND canonical_owner_user_id=OLD.canonical_owner_user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'account_history_review_is_immutable';
END $$;
--> statement-breakpoint
CREATE TRIGGER account_history_reviews_immutable BEFORE UPDATE OR DELETE ON account_history_reviews
  FOR EACH ROW EXECUTE FUNCTION preserve_account_history_review();
