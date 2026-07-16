const LEGACY_ID_PATTERN = /^[0-9a-f]{24}$/;

export const FOUNT_BINDING_DISCOVERY_SQL = `
  select
    legacy_asset_id,
    count(*)::int as row_count,
    min(snapshot_date)::text as start_date,
    max(snapshot_date)::text as end_date
  from daily_position_snapshots
  where is_sample = false
    and lower(btrim(asset_name)) = lower(btrim($1::text))
    and lower(btrim(account)) = lower(btrim($2::text))
    and lower(btrim(market)) = lower(btrim($3::text))
    and upper(btrim(currency)) = upper(btrim($4::text))
    and lower(btrim(coalesce(asset_type, ''))) = lower(btrim($5::text))
  group by legacy_asset_id
  order by min(snapshot_date), legacy_asset_id
`;

export const FOUNT_BINDING_POSITION_SQL = `
  select
    legacy_asset_id,
    snapshot_date::text as snapshot_date,
    account,
    source,
    asset_name,
    market,
    currency,
    coalesce(asset_type, '') as asset_type
  from daily_position_snapshots
  where is_sample = false and legacy_asset_id = $1::varchar(24)
  order by snapshot_date, account, source
`;

export const FOUNT_BINDING_EVENT_SQL = `
  select
    legacy_asset_id,
    event_date::text as event_date,
    account,
    asset_name
  from event_ledger_entries
  where is_sample = false and legacy_asset_id = $1::varchar(24)
  order by event_date, account
`;

const SERVICE_AXIS_CTE = `
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
  selected_service_dates as (
    select d.snapshot_date
    from complete_portfolio_dates d
    cross join anchor a
    where a.snapshot_date is not null and d.snapshot_date >= a.snapshot_date
  )
`;

export const FOUNT_SERVICE_DATES_SQL = `
  ${SERVICE_AXIS_CTE}
  select snapshot_date::text as service_date
  from selected_service_dates
  order by snapshot_date
`;

export const FOUNT_PORTFOLIO_EVIDENCE_SQL = `
  ${SERVICE_AXIS_CTE}
  select
    p.snapshot_date::text as snapshot_date,
    p.account,
    p.source,
    p.total_market_value::text as total_market_value_krw
  from daily_portfolio_snapshots p
  join selected_service_dates d on d.snapshot_date = p.snapshot_date
  where p.is_sample = false
    and p.account in ('brokerage', 'isa', 'irp', 'all')
  order by p.snapshot_date, p.account, p.source
`;

export const FOUNT_POSITION_EVIDENCE_SQL = `
  ${SERVICE_AXIS_CTE}
  select
    h.snapshot_date::text as snapshot_date,
    h.account,
    h.source,
    h.legacy_asset_id,
    h.market_value_krw::text as market_value_krw
  from daily_position_snapshots h
  join selected_service_dates d on d.snapshot_date = h.snapshot_date
  where h.is_sample = false
    and h.account in ('brokerage', 'isa', 'irp')
  order by h.snapshot_date, h.account, h.source, h.legacy_asset_id
`;

export const FOUNT_EVENT_EVIDENCE_SQL = `
  ${SERVICE_AXIS_CTE},
  selected_bounds as (
    select min(snapshot_date) as start_date, max(snapshot_date) as end_date
    from selected_service_dates
  )
  select
    e.event_date::text as event_date,
    e.legacy_asset_id
  from event_ledger_entries e
  cross join selected_bounds b
  where e.is_sample = false
    and b.start_date is not null
    and e.event_date between b.start_date and b.end_date
  order by e.event_date, e.legacy_asset_id
`;

export async function loadInvestmentLabFountReadinessEvidence(sql, decision) {
  const candidateRows = await sql.query(FOUNT_BINDING_DISCOVERY_SQL, [
    decision.assetName,
    decision.account,
    decision.market,
    decision.currency,
    decision.assetType,
  ]);
  const candidateId =
    candidateRows.length === 1 &&
    LEGACY_ID_PATTERN.test(String(candidateRows[0].legacy_asset_id ?? ""))
      ? String(candidateRows[0].legacy_asset_id)
      : null;

  if (!candidateId) {
    return Object.freeze({
      candidateRows,
      bindingPositionRows: null,
      bindingEventRows: null,
      serviceDateRows: null,
      portfolioRows: null,
      positionRows: null,
      eventRows: null,
    });
  }

  const [
    bindingPositionRows,
    bindingEventRows,
    serviceDateRows,
    portfolioRows,
    positionRows,
    eventRows,
  ] = await Promise.all([
    sql.query(FOUNT_BINDING_POSITION_SQL, [candidateId]),
    sql.query(FOUNT_BINDING_EVENT_SQL, [candidateId]),
    sql.query(FOUNT_SERVICE_DATES_SQL),
    sql.query(FOUNT_PORTFOLIO_EVIDENCE_SQL),
    sql.query(FOUNT_POSITION_EVIDENCE_SQL),
    sql.query(FOUNT_EVENT_EVIDENCE_SQL),
  ]);

  return Object.freeze({
    candidateRows,
    bindingPositionRows,
    bindingEventRows,
    serviceDateRows,
    portfolioRows,
    positionRows,
    eventRows,
  });
}
