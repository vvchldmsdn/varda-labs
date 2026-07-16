const AUDIT_AXIS_CTE = `
  with named_portfolio_rows as (
    select snapshot_date, account, source
    from daily_portfolio_snapshots
    where is_sample = false
      and account in ('brokerage', 'isa', 'irp')
  ),
  complete_portfolio_dates as (
    select snapshot_date
    from named_portfolio_rows
    group by snapshot_date
    having count(*) = 3 and count(distinct account) = 3
  ),
  candidate_anchor_dates as (
    select p.snapshot_date
    from named_portfolio_rows p
    join complete_portfolio_dates d on d.snapshot_date = p.snapshot_date
    join daily_position_snapshots h
      on h.snapshot_date = p.snapshot_date
      and h.account = p.account
      and h.source = p.source
      and h.is_sample = false
    group by p.snapshot_date
    having count(distinct h.account) = 3
  ),
  anchor as (
    select min(snapshot_date) as snapshot_date from candidate_anchor_dates
  ),
  audit_dates as (
    select distinct p.snapshot_date
    from named_portfolio_rows p
    cross join anchor a
    where a.snapshot_date is not null and p.snapshot_date >= a.snapshot_date
  )
`;

export const SOURCE_TRANSITION_SEGMENTS_SQL = `
  ${AUDIT_AXIS_CTE}
  select
    p.source,
    p.account,
    count(*)::int as row_count,
    count(distinct p.snapshot_date)::int as date_count,
    min(p.snapshot_date)::text as start_date,
    max(p.snapshot_date)::text as end_date,
    count(*) filter (where p.legacy_base44_id is not null)::int as imported_identity_rows,
    count(*) filter (where p.legacy_base44_id is null)::int as generated_identity_rows,
    count(*) filter (where p.rule_version is not null)::int as rule_version_rows
  from daily_portfolio_snapshots p
  join audit_dates d on d.snapshot_date = p.snapshot_date
  where p.is_sample = false
    and p.account in ('brokerage', 'isa', 'irp')
  group by p.source, p.account
  order by min(p.snapshot_date), p.account, p.source
`;

export const SOURCE_TRANSITION_AXIS_SQL = `
  ${AUDIT_AXIS_CTE}
  select
    d.snapshot_date::text as snapshot_date,
    count(p.snapshot_date)::int as named_row_count,
    count(distinct p.account)::int as account_count,
    count(distinct p.source)::int as source_count,
    count(*) filter (
      where p.source not in ('base44_import', 'varda_manual_daily_snapshot')
    )::int as unknown_source_rows
  from audit_dates d
  left join daily_portfolio_snapshots p
    on p.snapshot_date = d.snapshot_date
    and p.is_sample = false
    and p.account in ('brokerage', 'isa', 'irp')
  group by d.snapshot_date
  order by d.snapshot_date
`;

export const SOURCE_TRANSITION_CHANGES_SQL = `
  ${AUDIT_AXIS_CTE},
  distinct_account_sources as (
    select distinct p.snapshot_date, p.account, p.source
    from daily_portfolio_snapshots p
    join audit_dates d on d.snapshot_date = p.snapshot_date
    where p.is_sample = false
      and p.account in ('brokerage', 'isa', 'irp')
  ),
  sequenced as (
    select
      snapshot_date,
      account,
      source,
      lag(source) over (partition by account order by snapshot_date, source) as previous_source
    from distinct_account_sources
  )
  select
    snapshot_date::text as snapshot_date,
    account,
    previous_source,
    source
  from sequenced
  where previous_source is not null and previous_source <> source
  order by snapshot_date, account
`;

export const SOURCE_TRANSITION_RECONCILIATION_SQL = `
  ${AUDIT_AXIS_CTE},
  position_groups as (
    select
      h.snapshot_date,
      h.account,
      h.source,
      count(*)::int as position_count,
      coalesce(sum(h.market_value_krw), 0)::text as position_total_krw
    from daily_position_snapshots h
    join audit_dates d on d.snapshot_date = h.snapshot_date
    where h.is_sample = false
      and h.account in ('brokerage', 'isa', 'irp')
    group by h.snapshot_date, h.account, h.source
  ),
  duplicate_position_groups as (
    select snapshot_date, account, source, count(*)::int as duplicate_identity_count
    from (
      select h.snapshot_date, h.account, h.source, h.legacy_asset_id
      from daily_position_snapshots h
      join audit_dates d on d.snapshot_date = h.snapshot_date
      where h.is_sample = false
        and h.account in ('brokerage', 'isa', 'irp')
      group by h.snapshot_date, h.account, h.source, h.legacy_asset_id
      having count(*) > 1
    ) duplicates
    group by snapshot_date, account, source
  )
  select
    p.snapshot_date::text as snapshot_date,
    p.account,
    p.source,
    p.total_market_value::text as portfolio_total_krw,
    coalesce(p.cash_value, 0)::text as cash_value_krw,
    coalesce(g.position_count, 0)::int as position_count,
    coalesce(g.position_total_krw, '0') as position_total_krw,
    coalesce(dup.duplicate_identity_count, 0)::int as duplicate_identity_count
  from daily_portfolio_snapshots p
  join audit_dates d on d.snapshot_date = p.snapshot_date
  left join position_groups g
    on g.snapshot_date = p.snapshot_date
    and g.account = p.account
    and g.source = p.source
  left join duplicate_position_groups dup
    on dup.snapshot_date = p.snapshot_date
    and dup.account = p.account
    and dup.source = p.source
  where p.is_sample = false
    and p.account in ('brokerage', 'isa', 'irp')
  order by p.snapshot_date, p.account, p.source
`;

export const SOURCE_TRANSITION_POSITION_BASIS_SQL = `
  ${AUDIT_AXIS_CTE}
  select
    h.source,
    count(*)::int as position_rows,
    count(*) filter (where btrim(coalesce(h.ticker, '')) = '')::int as tickerless_rows,
    count(*) filter (
      where btrim(coalesce(h.ticker, '')) <> ''
        and lower(coalesce(h.price_basis, '')) <> 'close'
    )::int as tickered_non_close_rows,
    count(*) filter (where h.reference_date is null)::int as missing_reference_date_rows,
    count(*) filter (
      where btrim(coalesce(h.ticker, '')) <> '' and h.reference_date is null
    )::int as missing_tickered_reference_date_rows,
    count(*) filter (
      where btrim(coalesce(h.ticker, '')) = '' and h.reference_date is null
    )::int as missing_tickerless_reference_date_rows,
    count(*) filter (
      where h.reference_date is not null
        and h.price_date is not null
        and h.reference_date <> h.price_date
    )::int as reference_price_date_mismatch_rows,
    count(*) filter (where upper(coalesce(h.currency, '')) = 'USD')::int as usd_rows,
    count(*) filter (
      where upper(coalesce(h.currency, '')) = 'USD'
        and (h.fx_rate is null or h.fx_rate <= 0)
    )::int as invalid_usd_fx_rows,
    count(*) filter (
      where upper(coalesce(h.currency, '')) = 'USD'
        and h.fx_reference_date is null
    )::int as missing_usd_fx_reference_rows,
    count(*) filter (
      where lower(coalesce(h.price_basis, '')) = 'fallback_current'
        or lower(coalesce(h.description, '')) like '%asset.current_price%'
    )::int as legacy_fallback_marker_rows
  from daily_position_snapshots h
  join audit_dates d on d.snapshot_date = h.snapshot_date
  where h.is_sample = false
    and h.account in ('brokerage', 'isa', 'irp')
  group by h.source
  order by min(h.snapshot_date), h.source
`;

export const SOURCE_TRANSITION_ALL_RECONCILIATION_SQL = `
  ${AUDIT_AXIS_CTE},
  named_totals as (
    select
      p.snapshot_date,
      sum(p.total_market_value)::text as derived_total_krw
    from daily_portfolio_snapshots p
    join audit_dates d on d.snapshot_date = p.snapshot_date
    where p.is_sample = false
      and p.account in ('brokerage', 'isa', 'irp')
    group by p.snapshot_date
  ),
  stored_all as (
    select
      p.snapshot_date,
      count(*)::int as stored_row_count,
      min(p.total_market_value)::text as stored_total_krw,
      max(p.total_market_value)::text as stored_total_max_krw
    from daily_portfolio_snapshots p
    join audit_dates d on d.snapshot_date = p.snapshot_date
    where p.is_sample = false and p.account = 'all'
    group by p.snapshot_date
  )
  select
    n.snapshot_date::text as snapshot_date,
    n.derived_total_krw,
    coalesce(a.stored_row_count, 0)::int as stored_row_count,
    a.stored_total_krw,
    a.stored_total_max_krw
  from named_totals n
  left join stored_all a on a.snapshot_date = n.snapshot_date
  order by n.snapshot_date
`;

export async function loadInvestmentLabSourceTransitionEvidence(sql) {
  const [segmentRows, axisRows, transitionRows, reconciliationRows, basisRows, allRows] =
    await Promise.all([
      sql.query(SOURCE_TRANSITION_SEGMENTS_SQL),
      sql.query(SOURCE_TRANSITION_AXIS_SQL),
      sql.query(SOURCE_TRANSITION_CHANGES_SQL),
      sql.query(SOURCE_TRANSITION_RECONCILIATION_SQL),
      sql.query(SOURCE_TRANSITION_POSITION_BASIS_SQL),
      sql.query(SOURCE_TRANSITION_ALL_RECONCILIATION_SQL),
    ]);

  return Object.freeze({
    segmentRows,
    axisRows,
    transitionRows,
    reconciliationRows,
    basisRows,
    allRows,
  });
}
