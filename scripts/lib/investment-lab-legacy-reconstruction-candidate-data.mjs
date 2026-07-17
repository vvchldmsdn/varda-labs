import { SOURCE_TRANSITION_AUDIT_AXIS_CTE } from "./investment-lab-source-transition-data.mjs";

export const LEGACY_RECONSTRUCTION_CANDIDATE_SQL = `
  ${SOURCE_TRANSITION_AUDIT_AXIS_CTE},
  ticker_consensus as (
    select
      legacy_asset_id,
      count(distinct upper(btrim(ticker))) filter (
        where nullif(btrim(ticker), '') is not null
      )::int as ticker_count,
      min(upper(btrim(ticker))) filter (
        where nullif(btrim(ticker), '') is not null
      ) as consensus_ticker
    from daily_position_snapshots
    where is_sample = false
      and source = 'base44_import'
      and nullif(btrim(legacy_asset_id), '') is not null
    group by legacy_asset_id
  ),
  legacy_positions as (
    select
      h.*,
      case
        when nullif(btrim(h.ticker), '') is not null then upper(btrim(h.ticker))
        when coalesce(tc.ticker_count, 0) = 1 then tc.consensus_ticker
        else null
      end as effective_ticker,
      coalesce(tc.ticker_count, 0)::int as identity_ticker_count,
      substring(
        coalesce(h.description, '')
        from 'fx_source=FxRate\\(([0-9]{4}-[0-9]{2}-[0-9]{2})\\)'
      ) as described_fx_date
    from daily_position_snapshots h
    join audit_dates d on d.snapshot_date = h.snapshot_date
    left join ticker_consensus tc on tc.legacy_asset_id = h.legacy_asset_id
    where h.is_sample = false
      and h.source = 'base44_import'
      and h.account in ('brokerage', 'isa', 'irp')
  ),
  position_evidence as (
    select
      h.*,
      (
        select count(*)::int
        from asset_price_snapshots p
        where p.is_sample = false
          and upper(btrim(p.ticker)) = h.effective_ticker
          and p.date = h.reference_date
          and lower(btrim(p.market)) = lower(btrim(h.market))
          and upper(btrim(p.currency)) = upper(btrim(h.currency))
      ) as price_identity_match_count,
      (
        select count(*)::int
        from asset_price_snapshots p
        where p.is_sample = false
          and upper(btrim(p.ticker)) = h.effective_ticker
          and p.date = h.reference_date
          and lower(btrim(p.market)) = lower(btrim(h.market))
          and upper(btrim(p.currency)) = upper(btrim(h.currency))
          and p.close_price = h.close_price
      ) as price_value_match_count,
      (
        select count(*)::int
        from asset_price_snapshots p
        where p.is_sample = false
          and upper(btrim(p.ticker)) = h.effective_ticker
          and p.date = h.reference_date
          and lower(btrim(p.market)) = lower(btrim(h.market))
          and upper(btrim(p.currency)) = upper(btrim(h.currency))
          and p.close_price = h.close_price
          and lower(btrim(coalesce(p.source, ''))) =
            lower(btrim(coalesce(h.price_source, '')))
      ) as price_source_match_count,
      (
        select count(*)::int
        from fx_rates f
        where f.is_sample = false
          and h.described_fx_date is not null
          and f.date = h.described_fx_date::date
      ) as fx_date_match_count,
      (
        select count(*)::int
        from fx_rates f
        where f.is_sample = false
          and h.described_fx_date is not null
          and f.date = h.described_fx_date::date
          and f.usdkrw = h.fx_rate
      ) as fx_value_match_count,
      (
        select count(*)::int
        from fx_rates f
        where f.is_sample = false
          and h.described_fx_date is not null
          and f.date = h.described_fx_date::date
          and f.usdkrw = h.fx_rate
          and lower(btrim(coalesce(f.status, ''))) = 'ok'
      ) as fx_usable_match_count
    from legacy_positions h
  )
  select
    p.snapshot_date::text as snapshot_date,
    p.account,
    p.source as portfolio_source,
    p.total_market_value::text as portfolio_total_krw,
    coalesce(p.cash_value, 0)::text as cash_value_krw,
    p.num_assets,
    p.rule_version as portfolio_rule_version,
    p.description as portfolio_description,
    p.captured_at::text as portfolio_captured_at,
    p.cycle_start_at::text as portfolio_cycle_start_at,
    p.cycle_end_at::text as portfolio_cycle_end_at,
    p.base44_created_at::text as portfolio_base44_created_at,
    p.base44_updated_at::text as portfolio_base44_updated_at,
    h.legacy_base44_id as position_legacy_id,
    h.legacy_asset_id,
    h.effective_ticker,
    h.identity_ticker_count,
    h.asset_name,
    h.market,
    h.currency,
    h.asset_type,
    h.price_source,
    h.price_basis,
    h.description as position_description,
    h.quantity::text as quantity,
    h.close_price::text as close_price,
    h.fractional_krw_value::text as fractional_krw_value,
    h.fx_rate::text as fx_rate,
    h.market_value_krw::text as market_value_krw,
    h.price_date::text as price_date,
    h.reference_date::text as reference_date,
    h.fx_reference_date::text as fx_reference_date,
    h.described_fx_date,
    h.captured_at::text as position_captured_at,
    h.cycle_start_at::text as position_cycle_start_at,
    h.cycle_end_at::text as position_cycle_end_at,
    h.source_created_at::text as position_source_created_at,
    h.base44_created_at::text as position_base44_created_at,
    h.base44_updated_at::text as position_base44_updated_at,
    h.price_identity_match_count,
    h.price_value_match_count,
    h.price_source_match_count,
    h.fx_date_match_count,
    h.fx_value_match_count,
    h.fx_usable_match_count
  from daily_portfolio_snapshots p
  join audit_dates d on d.snapshot_date = p.snapshot_date
  left join position_evidence h
    on h.snapshot_date = p.snapshot_date
    and h.account = p.account
    and h.source = p.source
  where p.is_sample = false
    and p.source = 'base44_import'
    and p.account in ('brokerage', 'isa', 'irp')
  order by p.snapshot_date, p.account, h.legacy_asset_id
`;

export async function loadInvestmentLabLegacyReconstructionCandidateEvidence(sql) {
  const rows = await sql.query(LEGACY_RECONSTRUCTION_CANDIDATE_SQL);
  return Object.freeze({ rows });
}
