-- An account statement is an evidence receipt. Publishing one does not create
-- sales, affect opening lots, or invalidate a daily close.
CREATE TABLE public.account_realized_profit_reviews (
  canonical_owner_user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  evidence_hash varchar(64) NOT NULL CHECK (evidence_hash ~ '^[0-9a-f]{64}$'),
  start_date date NOT NULL,
  end_date date NOT NULL,
  months jsonb NOT NULL,
  evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (account_id, evidence_hash),
  FOREIGN KEY (account_id, canonical_owner_user_id)
    REFERENCES public.accounts(id, canonical_owner_user_id) ON DELETE CASCADE,
  CONSTRAINT realized_review_dates CHECK (end_date >= start_date),
  CONSTRAINT realized_review_months CHECK (jsonb_typeof(months) = 'array' AND jsonb_array_length(months) BETWEEN 1 AND 1200
    AND jsonb_array_length(months) = (extract(year from end_date) - extract(year from start_date))*12
        + extract(month from end_date) - extract(month from start_date) + 1),
  CONSTRAINT realized_review_provenance CHECK (jsonb_typeof(evidence) = 'object' AND
    evidence @> '{"version":1,"basis":"broker_reported_realized_subtotals"}'::jsonb)
);
--> statement-breakpoint
CREATE INDEX realized_review_latest ON public.account_realized_profit_reviews
  (canonical_owner_user_id, account_id, created_at DESC, evidence_hash DESC);
--> statement-breakpoint
ALTER TABLE public.account_realized_profit_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY realized_review_owner ON public.account_realized_profit_reviews FOR SELECT TO varda_tenant_app
  USING (canonical_owner_user_id = nullif(current_setting('app.current_user_id', true),'')::uuid);
--> statement-breakpoint
REVOKE ALL ON public.account_realized_profit_reviews FROM PUBLIC, varda_tenant_app;
--> statement-breakpoint
GRANT SELECT (canonical_owner_user_id, account_id, evidence_hash, start_date, end_date, months, created_at)
  ON public.account_realized_profit_reviews TO varda_tenant_app;
--> statement-breakpoint
CREATE FUNCTION public.preserve_realized_profit_review() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.accounts
    WHERE id = OLD.account_id AND canonical_owner_user_id = OLD.canonical_owner_user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'realized_profit_review_is_immutable';
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.preserve_realized_profit_review() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER realized_review_immutable BEFORE UPDATE OR DELETE ON public.account_realized_profit_reviews
  FOR EACH ROW EXECUTE FUNCTION public.preserve_realized_profit_review();
