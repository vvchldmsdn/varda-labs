import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);

const ANCHOR_SQL = `
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
  complete_position_dates as (
    select snapshot_date
    from daily_position_snapshots
    where is_sample = false
      and account in ('brokerage', 'isa', 'irp')
    group by snapshot_date
    having count(distinct account) = 3
  ),
  anchor as (
    select min(p.snapshot_date) as snapshot_date
    from complete_portfolio_dates p
    join complete_position_dates h on h.snapshot_date = p.snapshot_date
  ),
  anchor_portfolios as (
    select p.snapshot_date, p.account, p.source
    from named_portfolio_rows p
    join anchor a on a.snapshot_date = p.snapshot_date
  ),
  anchor_positions as (
    select
      p.account,
      p.source,
      upper(nullif(btrim(p.ticker), '')) as ticker,
      lower(nullif(btrim(p.market), '')) as market,
      upper(nullif(btrim(p.currency), '')) as currency,
      nullif(btrim(p.asset_name), '') as asset_name,
      lower(nullif(btrim(p.asset_type), '')) as asset_type,
      lower(nullif(btrim(p.category), '')) as category,
      p.quantity,
      p.market_value_krw
    from daily_position_snapshots p
    join anchor_portfolios a
      on a.snapshot_date = p.snapshot_date
      and a.account = p.account
      and a.source = p.source
    where p.is_sample = false
  ),
  price_summary as (
    select
      upper(btrim(ticker)) as ticker,
      lower(btrim(market)) as market,
      upper(btrim(currency)) as currency,
      count(*)::int as price_rows,
      count(distinct date)::int as price_dates,
      min(date)::text as price_start_date,
      max(date)::text as price_end_date,
      count(*) filter (
        where close_price is null or close_price <= 0
          or adjusted_close_price is null or adjusted_close_price <= 0
      )::int as invalid_price_rows
    from asset_price_snapshots
    where is_sample = false
    group by upper(btrim(ticker)), lower(btrim(market)), upper(btrim(currency))
  ),
  price_duplicates as (
    select ticker, market, currency, count(*)::int as duplicate_date_groups
    from (
      select
        upper(btrim(ticker)) as ticker,
        lower(btrim(market)) as market,
        upper(btrim(currency)) as currency,
        date
      from asset_price_snapshots
      where is_sample = false
      group by upper(btrim(ticker)), lower(btrim(market)),
        upper(btrim(currency)), date
      having count(*) > 1
    ) rows
    group by ticker, market, currency
  ),
  anchor_instruments as (
    select
      ticker,
      market,
      currency,
      min(asset_name) as asset_name,
      min(asset_type) as asset_type,
      min(category) as category,
      count(*)::int as source_rows,
      count(distinct account)::int as account_count,
      count(distinct source)::int as source_count,
      sum(market_value_krw) as stored_market_value_krw,
      count(*) filter (
        where quantity is null or quantity <= 0
      )::int as invalid_quantity_rows,
      count(*) filter (
        where market_value_krw is null or market_value_krw < 0
      )::int as invalid_value_rows
    from anchor_positions
    group by ticker, market, currency
  )
  select
    (select snapshot_date::text from anchor) as anchor_date,
    i.ticker,
    i.market,
    i.currency,
    i.asset_name,
    i.asset_type,
    i.category,
    i.source_rows,
    i.account_count,
    i.source_count,
    i.stored_market_value_krw,
    i.invalid_quantity_rows,
    i.invalid_value_rows,
    coalesce(p.price_rows, 0)::int as price_rows,
    coalesce(p.price_dates, 0)::int as price_dates,
    p.price_start_date,
    p.price_end_date,
    coalesce(p.invalid_price_rows, 0)::int as invalid_price_rows,
    coalesce(d.duplicate_date_groups, 0)::int as duplicate_price_date_groups
  from anchor_instruments i
  left join price_summary p
    on p.ticker = i.ticker
    and p.market = i.market
    and p.currency = i.currency
  left join price_duplicates d
    on d.ticker = i.ticker
    and d.market = i.market
    and d.currency = i.currency
  order by i.market nulls last, i.currency nulls last, i.ticker nulls last
`;

const SUMMARY_SQL = `
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
  complete_position_dates as (
    select snapshot_date
    from daily_position_snapshots
    where is_sample = false
      and account in ('brokerage', 'isa', 'irp')
    group by snapshot_date
    having count(distinct account) = 3
  ),
  anchor as (
    select min(p.snapshot_date) as snapshot_date
    from complete_portfolio_dates p
    join complete_position_dates h on h.snapshot_date = p.snapshot_date
  ),
  anchor_portfolios as (
    select p.snapshot_date, p.account, p.source
    from named_portfolio_rows p
    join anchor a on a.snapshot_date = p.snapshot_date
  ),
  anchor_positions as (
    select p.*
    from daily_position_snapshots p
    join anchor_portfolios a
      on a.snapshot_date = p.snapshot_date
      and a.account = p.account
      and a.source = p.source
    where p.is_sample = false
  ),
  date_account_positions as (
    select p.*
    from daily_position_snapshots p
    join anchor a on a.snapshot_date = p.snapshot_date
    where p.is_sample = false
      and p.account in ('brokerage', 'isa', 'irp')
  )
  select
    (select snapshot_date::text from anchor) as anchor_date,
    (select count(*)::int from anchor_portfolios) as portfolio_rows,
    (select count(distinct account)::int from anchor_portfolios) as accounts,
    (select count(distinct source)::int from anchor_portfolios) as sources,
    count(*)::int as position_rows,
    (select count(*)::int from date_account_positions) as date_account_position_rows,
    (select count(distinct source)::int from date_account_positions) as position_sources,
    count(*) filter (
      where ticker is null or btrim(ticker) = ''
    )::int as tickerless_rows,
    count(*) filter (
      where lower(coalesce(market, '')) not in ('korea', 'us')
        or upper(coalesce(currency, '')) not in ('KRW', 'USD')
    )::int as unsupported_axis_rows,
    count(*) filter (
      where quantity is null or quantity <= 0
        or market_value_krw is null or market_value_krw < 0
    )::int as invalid_stored_value_rows,
    count(distinct (
      lower(coalesce(market, '')),
      upper(coalesce(currency, '')),
      upper(coalesce(ticker, ''))
    ))::int as economic_instruments
  from anchor_positions
`;

const SOURCE_SQL = `
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
  complete_position_dates as (
    select snapshot_date
    from daily_position_snapshots
    where is_sample = false
      and account in ('brokerage', 'isa', 'irp')
    group by snapshot_date
    having count(distinct account) = 3
  ),
  anchor as (
    select min(p.snapshot_date) as snapshot_date
    from complete_portfolio_dates p
    join complete_position_dates h on h.snapshot_date = p.snapshot_date
  ),
  portfolio_sources as (
    select p.snapshot_date, p.account, p.source
    from named_portfolio_rows p
    join anchor a on a.snapshot_date = p.snapshot_date
  ),
  position_sources as (
    select p.snapshot_date, p.account, p.source, count(*)::int as rows
    from daily_position_snapshots p
    join anchor a on a.snapshot_date = p.snapshot_date
    where p.is_sample = false
      and p.account in ('brokerage', 'isa', 'irp')
    group by p.snapshot_date, p.account, p.source
  )
  select
    coalesce(p.account, s.account) as account,
    p.source as portfolio_source,
    s.source as position_source,
    coalesce(s.rows, 0)::int as position_rows,
    (p.source = s.source) as exact_source_match
  from portfolio_sources p
  full join position_sources s
    on s.snapshot_date = p.snapshot_date
    and s.account = p.account
  order by coalesce(p.account, s.account), s.source
`;

const CANDIDATE_SQL = `
  with portfolio_dates as (
    select snapshot_date
    from daily_portfolio_snapshots
    where is_sample = false
      and account in ('brokerage', 'isa', 'irp')
    group by snapshot_date
    having count(*) = 3 and count(distinct account) = 3
  ),
  portfolio_rows as (
    select p.snapshot_date, p.account, p.source
    from daily_portfolio_snapshots p
    join portfolio_dates d on d.snapshot_date = p.snapshot_date
    where p.is_sample = false
      and p.account in ('brokerage', 'isa', 'irp')
  )
  select
    p.snapshot_date::text as anchor_date,
    count(distinct p.account)::int as portfolio_accounts,
    count(h.*)::int as position_rows,
    count(distinct h.account)::int as position_accounts,
    count(h.*) filter (
      where h.ticker is null or btrim(h.ticker) = ''
    )::int as tickerless_rows,
    count(distinct (
      lower(coalesce(h.market, '')),
      upper(coalesce(h.currency, '')),
      upper(coalesce(h.ticker, ''))
    ))::int as economic_instruments
  from portfolio_rows p
  left join daily_position_snapshots h
    on h.snapshot_date = p.snapshot_date
    and h.account = p.account
    and h.source = p.source
    and h.is_sample = false
  group by p.snapshot_date
  having count(distinct h.account) = 3
  order by p.snapshot_date
`;

const [summaryRows, instrumentRows, sourceRows, candidateRows] = await Promise.all([
  sql.query(SUMMARY_SQL),
  sql.query(ANCHOR_SQL),
  sql.query(SOURCE_SQL),
  sql.query(CANDIDATE_SQL),
]);

const summary = summaryRows[0] ?? null;
const blockers = [];
if (!summary?.anchor_date) blockers.push("missing_complete_anchor");
if (Number(summary?.portfolio_rows ?? 0) !== 3) {
  blockers.push("ambiguous_anchor_portfolio_source");
}
if (Number(summary?.position_rows ?? 0) === 0) {
  blockers.push("missing_exact_source_anchor_positions");
}
if (
  Number(summary?.date_account_position_rows ?? 0) !==
  Number(summary?.position_rows ?? 0)
) {
  blockers.push("anchor_position_source_mismatch");
}
if (Number(summary?.tickerless_rows ?? 0) > 0) {
  blockers.push("tickerless_anchor_holding");
}
if (Number(summary?.unsupported_axis_rows ?? 0) > 0) {
  blockers.push("unsupported_anchor_holding_axis");
}
if (Number(summary?.invalid_stored_value_rows ?? 0) > 0) {
  blockers.push("invalid_anchor_position_evidence");
}
for (const row of instrumentRows) {
  if (row.ticker && Number(row.price_rows) === 0) {
    blockers.push(`missing_price_history:${row.market}:${row.currency}:${row.ticker}`);
  }
  if (Number(row.invalid_price_rows) > 0) {
    blockers.push(`invalid_price_history:${row.market}:${row.currency}:${row.ticker}`);
  }
  if (Number(row.duplicate_price_date_groups) > 0) {
    blockers.push(`duplicate_price_history:${row.market}:${row.currency}:${row.ticker}`);
  }
}

console.log(
  JSON.stringify(
    {
      audit: "investment_lab_anchor_basket_readiness",
      status: blockers.length === 0 ? "ready_for_path" : "unavailable",
      readOnly: true,
      policy: {
        anchor:
          "first_complete_exact_source_portfolio_and_position_intersection",
        identity: "market_currency_ticker_aggregated_across_accounts",
        exclusions: "forbidden_whole_scenario_unavailable",
      },
      summary,
      sourceEvidence: sourceRows,
      candidateAnchors: candidateRows,
      instruments: instrumentRows,
      blockers: [...new Set(blockers)].sort(),
      boundaries: {
        providerCalls: 0,
        databaseWrites: 0,
        schemaChanges: 0,
      },
    },
    null,
    2,
  ),
);
