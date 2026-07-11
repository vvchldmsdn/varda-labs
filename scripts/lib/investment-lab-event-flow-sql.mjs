export const INVESTMENT_LAB_EVENT_FLOW_SQL = `
  with event_evidence as (
    select
      lower(btrim(e.event_type)) as event_type,
      e.event_date::text as event_date,
      row_number() over (
        order by
          e.event_date,
          e.recorded_at nulls last,
          e.created_at,
          e.legacy_base44_id nulls last
      )::int as sequence,
      case
        when abs(coalesce(e.amount_krw, 0)) > 0
          then abs(e.amount_krw)
        when abs(coalesce(e.quantity_delta, 0)) * coalesce(e.price, 0) > 0
          and upper(coalesce(a.currency, '')) = 'KRW'
          then abs(e.quantity_delta) * e.price
        when abs(coalesce(e.quantity_delta, 0)) * coalesce(e.price, 0) > 0
          and coalesce(e.fx_rate, 0) > 0
          then abs(e.quantity_delta) * e.price * e.fx_rate
        else null
      end as resolved_amount_krw,
      case
        when abs(coalesce(e.amount_krw, 0)) > 0
          then 'explicit_amount_krw'
        when abs(coalesce(e.quantity_delta, 0)) * coalesce(e.price, 0) > 0
          and upper(coalesce(a.currency, '')) = 'KRW'
          then 'derived_quantity_price_krw'
        when abs(coalesce(e.quantity_delta, 0)) * coalesce(e.price, 0) > 0
          and coalesce(e.fx_rate, 0) > 0
          then 'derived_quantity_price_fx'
        else null
      end as amount_provenance,
      (
        e.corrects_event_id is not null
        or e.legacy_corrects_event_id is not null
      ) as is_correction
    from event_ledger_entries e
    left join assets a on a.id = e.asset_id
    where e.is_sample = false
  )
  select
    event_type,
    event_date,
    sequence,
    resolved_amount_krw,
    amount_provenance,
    (resolved_amount_krw is not null and resolved_amount_krw > 0) as amount_resolved,
    is_correction
  from event_evidence
  order by sequence
`;

export const INVESTMENT_LAB_DERIVED_ALL_PATH_SQL = `
  select
    snapshot_date::text as service_date,
    sum(total_market_value) as total_market_value_krw
  from daily_portfolio_snapshots
  where is_sample = false
    and account in ('brokerage', 'isa', 'irp')
  group by snapshot_date
  having count(distinct account) = 3
  order by snapshot_date
`;

export const INVESTMENT_LAB_KODEX_CLOSE_SQL = `
  select
    date::text as price_date,
    adjusted_close_price
  from asset_price_snapshots
  where is_sample = false
    and upper(btrim(ticker)) = '069500'
    and lower(btrim(market)) = 'korea'
    and upper(btrim(currency)) = 'KRW'
  order by date
`;

export const INVESTMENT_LAB_SNAPSHOT_BOUNDARY_SQL = `
  select
    count(*)::int as row_count,
    count(*) filter (where coalesce(cash_value, 0) <> 0)::int as nonzero_cash_rows,
    count(*) filter (where coalesce(total_market_value, 0) > 0)::int as positive_market_value_rows
  from daily_portfolio_snapshots
  where is_sample = false
`;
