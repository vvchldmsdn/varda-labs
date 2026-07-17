export const SNAPSHOT_EVIDENCE_SQL = `
  with account_rows as (
    select account, snapshot_date, total_market_value
    from daily_portfolio_snapshots
    where is_sample = false
      and account in ('brokerage', 'isa', 'irp')
  ),
  derived_all_rows as (
    select
      'all'::text as account,
      snapshot_date,
      sum(total_market_value) as total_market_value
    from account_rows
    group by snapshot_date
    having count(distinct account) = 3
  ),
  stored_all_rows as (
    select snapshot_date, total_market_value
    from daily_portfolio_snapshots
    where is_sample = false and account = 'all'
  ),
  reconciliation as (
    select
      (select count(*)::int from stored_all_rows) as stored_all_rows,
      (select count(*)::int from derived_all_rows) as derived_all_rows,
      count(s.snapshot_date)::int as overlap_dates,
      count(*) filter (
        where abs(d.total_market_value - s.total_market_value) > 1
      )::int as mismatch_dates
    from derived_all_rows d
    left join stored_all_rows s on s.snapshot_date = d.snapshot_date
  ),
  portfolio_rows as (
    select account, snapshot_date, total_market_value from account_rows
    union all
    select account, snapshot_date, total_market_value from derived_all_rows
  ),
  date_groups as (
    select account, snapshot_date, count(*)::int as rows
    from portfolio_rows
    group by account, snapshot_date
  )
  select
    p.account,
    count(*)::int as row_count,
    count(distinct p.snapshot_date)::int as distinct_dates,
    min(p.snapshot_date)::text as start_date,
    max(p.snapshot_date)::text as end_date,
    count(*) filter (
      where p.total_market_value is null or p.total_market_value <= 0
    )::int as invalid_rows,
    coalesce(max(collisions.groups), 0)::int as duplicate_date_groups,
    case when p.account = 'all'
      then (select mismatch_dates from reconciliation)
      else 0
    end::int as reconciliation_mismatch_rows,
    case when p.account = 'all'
      then (select stored_all_rows from reconciliation)
      else null
    end::int as stored_all_rows,
    case when p.account = 'all'
      then (select derived_all_rows from reconciliation)
      else null
    end::int as derived_all_rows,
    case when p.account = 'all'
      then (select overlap_dates from reconciliation)
      else null
    end::int as overlap_dates
  from portfolio_rows p
  left join (
    select account, count(*)::int as groups
    from date_groups
    where rows > 1
    group by account
  ) collisions on collisions.account = p.account
  group by p.account
  order by p.account
`;

export const TRADE_EVIDENCE_SQL = `
  select
    nullif(lower(btrim(e.account)), '') as account,
    nullif(lower(btrim(a.account)), '') as asset_account,
    (
      select case
        when count(*) > 0
          and bool_and(lower(btrim(p.account)) in ('brokerage', 'isa', 'irp'))
          and count(distinct lower(btrim(p.account))) = 1
        then min(lower(btrim(p.account)))
        else null
      end
      from daily_position_snapshots p
      where p.is_sample = false
        and p.legacy_asset_id = e.legacy_asset_id
    ) as historical_position_account,
    e.event_date::text as event_date,
    case
      when abs(coalesce(e.amount_krw, 0)) > 0 then true
      when abs(coalesce(e.quantity_delta, 0)) * coalesce(e.price, 0) > 0
        and (
          upper(coalesce(a.currency, '')) = 'KRW'
          or coalesce(e.fx_rate, 0) > 0
        ) then true
      else false
    end as amount_resolved,
    (
      e.corrects_event_id is not null
      or e.legacy_corrects_event_id is not null
    ) as is_correction,
    e.before_value,
    e.after_value
  from event_ledger_entries e
  left join assets a on a.id = e.asset_id
  where e.is_sample = false
    and e.event_type in ('buy', 'sell')
  order by e.event_date, e.recorded_at nulls last
`;

export const PRICE_EVIDENCE_SQL = `
  with universe as (
    select distinct
      upper(btrim(ticker)) as ticker,
      lower(btrim(market)) as market,
      upper(btrim(currency)) as currency
    from assets
    where ticker is not null
      and btrim(ticker) <> ''
      and quantity > 0
    union
    select '069500', 'korea', 'KRW'
    union
    select 'VOO', 'us', 'USD'
  ),
  price_summary as (
    select
      upper(btrim(ticker)) as ticker,
      lower(btrim(market)) as market,
      upper(btrim(currency)) as currency,
      count(*)::int as row_count,
      count(distinct date)::int as distinct_dates,
      min(date)::text as start_date,
      max(date)::text as end_date,
      count(*) filter (
        where adjusted_close_price <= 0 or close_price <= 0
      )::int as invalid_rows
    from asset_price_snapshots
    where is_sample = false
    group by
      upper(btrim(ticker)),
      lower(btrim(market)),
      upper(btrim(currency))
  ),
  duplicate_summary as (
    select ticker, market, currency, count(*)::int as groups
    from (
      select
        upper(btrim(ticker)) as ticker,
        lower(btrim(market)) as market,
        upper(btrim(currency)) as currency,
        date
      from asset_price_snapshots
      where is_sample = false
      group by
        upper(btrim(ticker)),
        lower(btrim(market)),
        upper(btrim(currency)),
        date
      having count(*) > 1
    ) duplicates
    group by ticker, market, currency
  )
  select
    u.ticker,
    u.market,
    u.currency,
    coalesce(p.row_count, 0)::int as row_count,
    coalesce(p.distinct_dates, 0)::int as distinct_dates,
    p.start_date,
    p.end_date,
    coalesce(p.invalid_rows, 0)::int as invalid_rows,
    coalesce(d.groups, 0)::int as duplicate_date_groups
  from universe u
  left join price_summary p
    on p.ticker = u.ticker
    and p.market = u.market
    and p.currency = u.currency
  left join duplicate_summary d
    on d.ticker = u.ticker
    and d.market = u.market
    and d.currency = u.currency
  order by u.market, u.currency, u.ticker
`;

export const FX_EVIDENCE_SQL = `
  select
    date::text as rate_date,
    (usdkrw > 0 and coalesce(status, '') = 'ok') as valid
  from fx_rates
  where is_sample = false
  order by date
`;
