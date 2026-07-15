import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const compactOutput = process.argv.includes("--compact");

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
  imported_ticker_consensus as (
    select
      legacy_asset_id,
      min(upper(btrim(ticker))) as ticker,
      count(*)::int as evidence_rows,
      count(distinct upper(btrim(ticker)))::int as ticker_count,
      count(distinct lower(btrim(asset_name)))::int as name_count,
      count(distinct lower(btrim(account)))::int as account_count,
      count(distinct lower(btrim(market)))::int as market_count,
      count(distinct upper(btrim(currency)))::int as currency_count,
      count(distinct lower(coalesce(btrim(asset_type), '')))::int
        as asset_type_count,
      min(lower(btrim(asset_name))) as asset_name_key,
      min(lower(btrim(account))) as account_key,
      min(lower(btrim(market))) as market_key,
      min(upper(btrim(currency))) as currency_key,
      min(lower(coalesce(btrim(asset_type), ''))) as asset_type_key
    from daily_position_snapshots
    where is_sample = false
      and source = 'base44_import'
      and nullif(btrim(ticker), '') is not null
    group by legacy_asset_id
  ),
  anchor_positions as (
    select
      p.account,
      p.source,
      p.legacy_asset_id,
      upper(nullif(btrim(p.ticker), '')) as stored_ticker,
      lower(nullif(btrim(p.market), '')) as market,
      upper(nullif(btrim(p.currency), '')) as currency,
      nullif(btrim(p.asset_name), '') as asset_name,
      lower(nullif(btrim(p.asset_type), '')) as asset_type,
      lower(nullif(btrim(p.category), '')) as category,
      p.quantity,
      p.market_value_krw,
      case
        when imported.ticker_count = 1
          and imported.name_count = 1
          and imported.account_count = 1
          and imported.market_count = 1
          and imported.currency_count = 1
          and imported.asset_type_count = 1
          and imported.asset_name_key = lower(btrim(p.asset_name))
          and imported.account_key = lower(btrim(p.account))
          and imported.market_key = lower(btrim(p.market))
          and imported.currency_key = upper(btrim(p.currency))
          and imported.asset_type_key =
            lower(coalesce(btrim(p.asset_type), ''))
        then imported.ticker
        else null
      end as imported_ticker,
      coalesce(imported.evidence_rows, 0)::int
        as imported_ticker_evidence_rows,
      case
        when imported.legacy_asset_id is null then 'no_imported_ticker_evidence'
        when imported.ticker_count <> 1 then 'conflicting_imported_tickers'
        when imported.name_count <> 1
          or imported.account_count <> 1
          or imported.market_count <> 1
          or imported.currency_count <> 1
          or imported.asset_type_count <> 1
          or imported.asset_name_key <> lower(btrim(p.asset_name))
          or imported.account_key <> lower(btrim(p.account))
          or imported.market_key <> lower(btrim(p.market))
          or imported.currency_key <> upper(btrim(p.currency))
          or imported.asset_type_key <>
            lower(coalesce(btrim(p.asset_type), ''))
        then 'metadata_mismatch'
        else 'consensus'
      end as imported_ticker_status
    from daily_position_snapshots p
    join anchor_portfolios a
      on a.snapshot_date = p.snapshot_date
      and a.account = p.account
      and a.source = p.source
    left join imported_ticker_consensus imported
      on imported.legacy_asset_id = p.legacy_asset_id
    where p.is_sample = false
  ),
  resolved_anchor_positions as (
    select
      *,
      coalesce(stored_ticker, imported_ticker) as ticker,
      case
        when stored_ticker is not null then 'stored_snapshot_ticker'
        when imported_ticker is not null
          then 'base44_imported_snapshot_ticker_consensus'
        when asset_type = 'commodity' then 'explicit_snapshot_asset_type'
        else 'none'
      end as identity_authority,
      case
        when stored_ticker is not null or imported_ticker is not null
          then 'resolved'
        else 'unavailable'
      end as identity_status
    from anchor_positions
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
  stored_series_summary as (
    select
      legacy_asset_id,
      count(*)::int as stored_series_rows,
      count(*) filter (where price_date is not null)::int as price_date_rows,
      count(*) filter (
        where lower(coalesce(price_basis, '')) like '%fallback%'
          or lower(coalesce(price_source, '')) like '%fallback%'
      )::int as fallback_price_rows,
      count(distinct nullif(btrim(price_basis), ''))::int as price_basis_count
    from daily_position_snapshots
    where is_sample = false
    group by legacy_asset_id
  ),
  anchor_instruments as (
    select
      ticker,
      market,
      currency,
      min(legacy_asset_id) as legacy_asset_id,
      min(asset_name) as asset_name,
      min(asset_type) as asset_type,
      min(category) as category,
      min(identity_authority) as identity_authority,
      min(identity_status) as identity_status,
      max(imported_ticker_evidence_rows)::int as imported_ticker_evidence_rows,
      min(imported_ticker_status) as imported_ticker_status,
      bool_or(stored_ticker is null) as stored_ticker_missing,
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
    from resolved_anchor_positions
    group by
      coalesce(
        'listed:' || market || ':' || currency || ':' || ticker,
        'legacy:' || legacy_asset_id
      ),
      ticker,
      market,
      currency
  )
  select
    (select snapshot_date::text from anchor) as anchor_date,
    i.ticker,
    i.market,
    i.currency,
    i.asset_name,
    i.asset_type,
    i.category,
    i.identity_authority,
    i.identity_status,
    i.stored_ticker_missing,
    case
      when i.ticker is not null then 'listed_instrument'
      when i.asset_type = 'commodity' then 'physical_commodity_position'
      else 'unresolved'
    end as classification,
    case
      when i.ticker is not null then 'eligible_historical_instrument'
      when i.asset_type in ('fixed_deposit', 'housing_subscription', 'savings')
        then 'permanently_unsupported'
      else 'separate_valuation_model_required'
    end as historical_authority_outcome,
    i.imported_ticker_evidence_rows,
    i.imported_ticker_status,
    case when i.currency = 'USD' then 'stored_usdkrw_required' else 'none' end
      as fx_requirement,
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
    coalesce(d.duplicate_date_groups, 0)::int as duplicate_price_date_groups,
    coalesce(s.stored_series_rows, 0)::int as stored_series_rows,
    coalesce(s.price_date_rows, 0)::int as stored_price_date_rows,
    coalesce(s.fallback_price_rows, 0)::int as stored_fallback_price_rows,
    coalesce(s.price_basis_count, 0)::int as stored_price_basis_count,
    case
      when i.ticker is not null
        and coalesce(p.price_rows, 0) > 0
        and coalesce(p.invalid_price_rows, 0) = 0
        and coalesce(d.duplicate_date_groups, 0) = 0
        then 'ticker_price_series_present_coverage_not_evaluated'
      when i.asset_type = 'commodity'
        then 'instrument_keyed_official_close_required'
      else 'historical_price_authority_unavailable'
    end as historical_price_authority
  from anchor_instruments i
  left join price_summary p
    on p.ticker = i.ticker
    and p.market = i.market
    and p.currency = i.currency
  left join price_duplicates d
    on d.ticker = i.ticker
    and d.market = i.market
    and d.currency = i.currency
  left join stored_series_summary s on s.legacy_asset_id = i.legacy_asset_id
  order by
    i.market nulls last,
    i.currency nulls last,
    i.ticker nulls last,
    i.asset_name
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
  imported_ticker_consensus as (
    select
      legacy_asset_id,
      min(upper(btrim(ticker))) as ticker,
      count(distinct upper(btrim(ticker)))::int as ticker_count,
      count(distinct lower(btrim(asset_name)))::int as name_count,
      count(distinct lower(btrim(account)))::int as account_count,
      count(distinct lower(btrim(market)))::int as market_count,
      count(distinct upper(btrim(currency)))::int as currency_count,
      count(distinct lower(coalesce(btrim(asset_type), '')))::int
        as asset_type_count,
      min(lower(btrim(asset_name))) as asset_name_key,
      min(lower(btrim(account))) as account_key,
      min(lower(btrim(market))) as market_key,
      min(upper(btrim(currency))) as currency_key,
      min(lower(coalesce(btrim(asset_type), ''))) as asset_type_key
    from daily_position_snapshots
    where is_sample = false
      and source = 'base44_import'
      and nullif(btrim(ticker), '') is not null
    group by legacy_asset_id
  ),
  anchor_positions as (
    select
      p.*,
      case
        when nullif(btrim(p.ticker), '') is not null
          then upper(btrim(p.ticker))
        when imported.ticker_count = 1
          and imported.name_count = 1
          and imported.account_count = 1
          and imported.market_count = 1
          and imported.currency_count = 1
          and imported.asset_type_count = 1
          and imported.asset_name_key = lower(btrim(p.asset_name))
          and imported.account_key = lower(btrim(p.account))
          and imported.market_key = lower(btrim(p.market))
          and imported.currency_key = upper(btrim(p.currency))
          and imported.asset_type_key =
            lower(coalesce(btrim(p.asset_type), ''))
        then imported.ticker
        else null
      end as resolved_ticker
    from daily_position_snapshots p
    join anchor_portfolios a
      on a.snapshot_date = p.snapshot_date
      and a.account = p.account
      and a.source = p.source
    left join imported_ticker_consensus imported
      on imported.legacy_asset_id = p.legacy_asset_id
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
      where (ticker is null or btrim(ticker) = '')
        and resolved_ticker is not null
    )::int as imported_snapshot_ticker_recovered_rows,
    count(*) filter (
      where resolved_ticker is null
    )::int as unresolved_identity_rows,
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
      resolved_ticker
    )) filter (where resolved_ticker is not null)::int
      as recognized_economic_instruments
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
    ))::int as stored_identity_groups
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
const unavailableIdentityRows = instrumentRows.filter(
  (row) => row.identity_status !== "resolved",
);
if (unavailableIdentityRows.length > 0) {
  blockers.push("tickerless_anchor_holding");
}
if (
  unavailableIdentityRows.some(
    (row) => row.classification === "physical_commodity_position",
  )
) {
  blockers.push("physical_anchor_holding_history_unavailable");
}
if (
  unavailableIdentityRows.some((row) => row.classification === "unresolved")
) {
  blockers.push("anchor_holding_classification_unresolved");
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

const report = {
  audit: "investment_lab_anchor_basket_readiness",
  status: blockers.length === 0 ? "ready_for_path" : "unavailable",
  readOnly: true,
  policy: {
    anchor: "first_complete_exact_source_portfolio_and_position_intersection",
    identity:
      "stored_ticker_or_base44_imported_snapshot_consensus_then_market_currency_ticker",
    importedIdentity:
      "same_legacy_identity_and_snapshot_metadata_consensus",
    currentAssetFallback: "forbidden",
    nameInference: "forbidden",
    exclusions: "forbidden_whole_scenario_unavailable",
  },
  summary,
  sourceEvidence: sourceRows,
  candidateAnchors: candidateRows,
  instruments: instrumentRows,
  specialHoldingAuthority: instrumentRows.filter(
    (row) => row.stored_ticker_missing,
  ),
  blockers: [...new Set(blockers)].sort(),
  boundaries: {
    providerCalls: 0,
    databaseWrites: 0,
    schemaChanges: 0,
  },
};

console.log(
  JSON.stringify(
    compactOutput
      ? {
          audit: report.audit,
          status: report.status,
          readOnly: report.readOnly,
          summary: report.summary,
          specialHoldingAuthority: report.specialHoldingAuthority,
          blockers: report.blockers,
          boundaries: report.boundaries,
        }
      : report,
    null,
    2,
  ),
);
