import { SOURCE_TRANSITION_AUDIT_AXIS_CTE } from "./investment-lab-source-transition-data.mjs";

export const LEGACY_RECONCILIATION_EVIDENCE_SQL = `
  ${SOURCE_TRANSITION_AUDIT_AXIS_CTE},
  duplicate_identity_groups as (
    select snapshot_date, account, source, count(*)::int as duplicate_identity_count
    from (
      select h.snapshot_date, h.account, h.source, h.legacy_asset_id
      from daily_position_snapshots h
      join audit_dates d on d.snapshot_date = h.snapshot_date
      where h.is_sample = false
        and h.source = 'base44_import'
        and h.account in ('brokerage', 'isa', 'irp')
        and nullif(btrim(h.legacy_asset_id), '') is not null
      group by h.snapshot_date, h.account, h.source, h.legacy_asset_id
      having count(*) > 1
    ) duplicates
    group by snapshot_date, account, source
  ),
  position_groups as (
    select
      h.snapshot_date,
      h.account,
      h.source,
      count(*)::int as position_count,
      count(h.market_value_krw)::int as valued_position_count,
      coalesce(sum(h.market_value_krw), 0)::text as position_total_krw,
      count(*) filter (where h.market_value_krw is null)::int as missing_value_rows,
      count(*) filter (
        where h.market_value_krw is not null
          and h.market_value_krw <> trunc(h.market_value_krw)
      )::int as fractional_value_rows,
      count(*) filter (
        where nullif(btrim(h.legacy_asset_id), '') is null
      )::int as missing_legacy_identity_rows,
      count(*) filter (
        where btrim(coalesce(h.ticker, '')) <> ''
          and lower(coalesce(h.price_basis, '')) <> 'close'
      )::int as tickered_non_close_rows,
      count(*) filter (
        where btrim(coalesce(h.ticker, '')) <> ''
          and h.reference_date is null
      )::int as missing_tickered_reference_date_rows,
      count(*) filter (
        where upper(coalesce(h.currency, '')) = 'USD'
          and (h.fx_rate is null or h.fx_rate <= 0 or h.fx_reference_date is null)
      )::int as incomplete_usd_fx_rows
    from daily_position_snapshots h
    join audit_dates d on d.snapshot_date = h.snapshot_date
    where h.is_sample = false
      and h.source = 'base44_import'
      and h.account in ('brokerage', 'isa', 'irp')
    group by h.snapshot_date, h.account, h.source
  )
  select
    p.snapshot_date::text as snapshot_date,
    p.account,
    p.total_market_value::text as portfolio_total_krw,
    coalesce(p.cash_value, 0)::text as cash_value_krw,
    p.num_assets,
    coalesce(g.position_count, 0)::int as position_count,
    coalesce(g.valued_position_count, 0)::int as valued_position_count,
    coalesce(g.position_total_krw, '0') as position_total_krw,
    coalesce(g.missing_value_rows, 0)::int as missing_value_rows,
    coalesce(g.fractional_value_rows, 0)::int as fractional_value_rows,
    coalesce(g.missing_legacy_identity_rows, 0)::int as missing_legacy_identity_rows,
    coalesce(g.tickered_non_close_rows, 0)::int as tickered_non_close_rows,
    coalesce(g.missing_tickered_reference_date_rows, 0)::int as missing_tickered_reference_date_rows,
    coalesce(g.incomplete_usd_fx_rows, 0)::int as incomplete_usd_fx_rows,
    coalesce(dup.duplicate_identity_count, 0)::int as duplicate_identity_count
  from daily_portfolio_snapshots p
  join audit_dates d on d.snapshot_date = p.snapshot_date
  left join position_groups g
    on g.snapshot_date = p.snapshot_date
    and g.account = p.account
    and g.source = p.source
  left join duplicate_identity_groups dup
    on dup.snapshot_date = p.snapshot_date
    and dup.account = p.account
    and dup.source = p.source
  where p.is_sample = false
    and p.source = 'base44_import'
    and p.account in ('brokerage', 'isa', 'irp')
  order by p.snapshot_date, p.account
`;

export async function loadInvestmentLabLegacyReconciliationEvidence(sql) {
  const rows = await sql.query(LEGACY_RECONCILIATION_EVIDENCE_SQL);
  return Object.freeze({ rows });
}
