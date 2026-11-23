-- A dated, flow-adjusted daily return is distinct from total_return_pct (profit on cost).
-- Existing valuations retain their original evidence. The daily worker fills new or revised closes.
ALTER TABLE daily_portfolio_snapshots ADD COLUMN closing_performance jsonb;
