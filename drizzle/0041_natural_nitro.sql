DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "global_market_factors"
    GROUP BY "factor_key", "date"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'global_market_factors contains duplicate factor_key/date rows';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE UNIQUE INDEX "global_market_factors_factor_key_date_unique" ON "global_market_factors" USING btree ("factor_key","date");
