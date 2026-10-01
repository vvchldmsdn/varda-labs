-- Private before-images of derived holdings valuations. Financial ledger rows
-- and original market evidence remain untouched by a repair.
CREATE TABLE holdings_snapshot_repair_archive (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 canonical_owner_user_id uuid NOT NULL REFERENCES app_users(id),
 account_id uuid REFERENCES accounts(id), snapshot_date date NOT NULL,
 revision integer NOT NULL CHECK(revision>0), portfolio_id uuid NOT NULL,
 portfolio jsonb NOT NULL, positions jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(portfolio_id,revision),
 CHECK(jsonb_typeof(portfolio)='object' AND jsonb_typeof(positions)='array')
);
ALTER TABLE holdings_snapshot_repair_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings_snapshot_repair_archive FORCE ROW LEVEL SECURITY;
REVOKE ALL ON holdings_snapshot_repair_archive FROM PUBLIC,varda_tenant_app;
CREATE FUNCTION guard_holdings_snapshot_archive() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'snapshot_archive_immutable'; END $$;
CREATE TRIGGER holdings_snapshot_archive_immutable BEFORE UPDATE OR DELETE ON holdings_snapshot_repair_archive
 FOR EACH ROW EXECUTE FUNCTION guard_holdings_snapshot_archive();
CREATE TRIGGER holdings_snapshot_archive_release BEFORE INSERT ON holdings_snapshot_repair_archive
 FOR EACH ROW EXECUTE FUNCTION guard_trade_reliability_write();

-- The revision and its work reservation commit together, including dates outside
-- the ordinary three-day discovery window and accounts sold down to zero.
CREATE FUNCTION enqueue_holdings_snapshot_revision() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 INSERT INTO public.daily_snapshot_work(canonical_owner_user_id,account_id,snapshot_date,stage,revision)
 SELECT NEW.canonical_owner_user_id,NEW.account_id,s.snapshot_date,'legacy',NEW.marker_sequence
 FROM public.daily_portfolio_snapshots s
 WHERE s.canonical_owner_user_id=NEW.canonical_owner_user_id AND s.account_id=NEW.account_id
   AND s.source='varda_manual_daily_snapshot' AND NOT s.is_sample
   AND NEW.affected_at<=coalesce(s.cycle_end_at,(s.snapshot_date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '7 hours')
 ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION enqueue_holdings_snapshot_revision() FROM PUBLIC,varda_tenant_app;
CREATE TRIGGER native_revision_holdings_work AFTER INSERT ON native_ledger_revisions
 FOR EACH ROW EXECUTE FUNCTION enqueue_holdings_snapshot_revision();

SELECT set_config('app.trade_reliability_version','0059',true);
INSERT INTO daily_snapshot_work(canonical_owner_user_id,account_id,snapshot_date,stage,revision)
 SELECT s.canonical_owner_user_id,s.account_id,s.snapshot_date,'legacy',max(r.marker_sequence)
 FROM daily_portfolio_snapshots s JOIN native_ledger_revisions r
 ON r.canonical_owner_user_id=s.canonical_owner_user_id AND r.account_id=s.account_id
 AND r.affected_at<=coalesce(s.cycle_end_at,(s.snapshot_date::timestamp AT TIME ZONE 'Asia/Seoul')+interval '7 hours')
 AND r.recorded_at>coalesce(s.captured_at,s.created_at)
 WHERE s.source='varda_manual_daily_snapshot' AND NOT s.is_sample AND s.account_id IS NOT NULL
 GROUP BY s.canonical_owner_user_id,s.account_id,s.snapshot_date ON CONFLICT DO NOTHING;
