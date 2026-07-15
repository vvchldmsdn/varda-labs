import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/investment-lab-special-holding-authority.ts";

config({ path: ".env.local", quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = neon(process.env.DATABASE_URL);
const compactOutput = process.argv.includes("--compact");
const goldDecision =
  DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
const fountDecision =
  DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;

function exactDecisionPredicate(alias, decision) {
  return [
    `lower(btrim(${alias}.asset_name)) = lower(${sqlLiteral(decision.assetName)})`,
    `lower(btrim(${alias}.account)) = ${sqlLiteral(decision.account)}`,
    `lower(btrim(${alias}.market)) = ${sqlLiteral(decision.market)}`,
    `upper(btrim(${alias}.currency)) = ${sqlLiteral(decision.currency)}`,
    `lower(btrim(${alias}.asset_type)) = ${sqlLiteral(decision.assetType)}`,
  ].join(" and ");
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const GOLD_POSITION_PREDICATE = exactDecisionPredicate("p", goldDecision);
const FOUNT_POSITION_PREDICATE = exactDecisionPredicate("p", fountDecision);
const FOUNT_INSTRUMENT_PREDICATE = exactDecisionPredicate("i", fountDecision);
const FOUNT_HISTORY_PREDICATE = exactDecisionPredicate("h", fountDecision);
const FOUNT_EVENT_PREDICATE = [
  `lower(btrim(e.asset_name)) = lower(${sqlLiteral(fountDecision.assetName)})`,
  `lower(btrim(e.account)) = ${sqlLiteral(fountDecision.account)}`,
].join(" and ");

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
        when ${GOLD_POSITION_PREDICATE}
          then 'broker_statement_and_krx_product_definition'
        when ${FOUNT_POSITION_PREDICATE}
          then 'product_owner_scope_decision'
        when asset_type = 'commodity' then 'explicit_snapshot_asset_type'
        else 'none'
      end as identity_authority,
      case
        when stored_ticker is not null or imported_ticker is not null
          then 'resolved'
        when ${GOLD_POSITION_PREDICATE} then 'resolved'
        when ${FOUNT_POSITION_PREDICATE} then 'not_required'
        else 'unavailable'
      end as identity_status
    from anchor_positions p
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
      count(distinct price_date)::int as stored_price_dates,
      count(*) filter (
        where lower(coalesce(price_basis, '')) like '%fallback%'
          or lower(coalesce(price_source, '')) like '%fallback%'
      )::int as fallback_price_rows,
      count(distinct nullif(btrim(price_basis), ''))::int as price_basis_count,
      count(distinct nullif(btrim(price_source), ''))::int as price_source_count,
      count(*) filter (
        where lower(coalesce(price_basis, '')) = 'close'
      )::int as legacy_close_label_rows,
      count(*) filter (
        where lower(coalesce(price_basis, '')) = 'close'
          and nullif(btrim(price_source), '') is null
      )::int as unattributed_close_label_rows,
      count(*) filter (
        where lower(coalesce(price_source, '')) =
            'krx_open_api_gold_daily'
          and lower(coalesce(price_basis, '')) = 'official_close'
          and price_date is not null
          and upper(coalesce(currency, '')) = 'KRW'
          and coalesce(unit_price, close_price, current_price) > 0
      )::int as official_gold_close_candidate_rows,
      count(distinct current_price) filter (
        where current_price is not null and current_price > 0
      )::int as distinct_current_prices,
      count(distinct quantity) filter (
        where quantity is not null and quantity > 0
      )::int as distinct_quantities,
      min(quantity) filter (
        where quantity is not null and quantity > 0
      ) as min_quantity,
      max(quantity) filter (
        where quantity is not null and quantity > 0
      ) as max_quantity,
      min(current_price) filter (
        where current_price is not null and current_price > 0
      ) as min_current_price,
      max(current_price) filter (
        where current_price is not null and current_price > 0
      ) as max_current_price,
      count(*) filter (
        where close_price is not null and close_price > 0
      )::int as explicit_close_price_rows,
      count(*) filter (
        where unit_price is not null and unit_price > 0
      )::int as explicit_unit_price_rows,
      count(*) filter (
        where quantity is not null and quantity > 0
          and current_price is not null and current_price > 0
          and market_value_krw is not null
          and abs(market_value_krw - quantity * current_price) > 0.01
      )::int as value_formula_mismatch_rows
    from daily_position_snapshots
    where is_sample = false
    group by legacy_asset_id
  ),
  event_series_summary as (
    select
      legacy_asset_id,
      count(*)::int as event_rows,
      min(event_date)::text as event_start_date,
      max(event_date)::text as event_end_date,
      count(distinct event_type)::int as event_type_count,
      count(*) filter (
        where price is not null and price > 0
      )::int as event_price_rows,
      count(*) filter (
        where quantity_delta is not null and quantity_delta <> 0
      )::int as event_quantity_rows
    from event_ledger_entries
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
      min(account) as account,
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
      when ${FOUNT_INSTRUMENT_PREDICATE} then 'product_owner_excluded'
      when i.ticker is not null then 'listed_instrument'
      when i.asset_type = 'commodity' then 'physical_commodity_position'
      else 'unresolved'
    end as classification,
    case
      when ${FOUNT_INSTRUMENT_PREDICATE} then 'intentionally_excluded'
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
    coalesce(s.stored_price_dates, 0)::int as stored_price_dates,
    coalesce(s.fallback_price_rows, 0)::int as stored_fallback_price_rows,
    coalesce(s.price_basis_count, 0)::int as stored_price_basis_count,
    coalesce(s.price_source_count, 0)::int as stored_price_source_count,
    coalesce(s.legacy_close_label_rows, 0)::int as legacy_close_label_rows,
    coalesce(s.unattributed_close_label_rows, 0)::int
      as unattributed_close_label_rows,
    coalesce(s.official_gold_close_candidate_rows, 0)::int
      as official_gold_close_candidate_rows,
    coalesce(s.distinct_current_prices, 0)::int as distinct_current_prices,
    coalesce(s.distinct_quantities, 0)::int as distinct_quantities,
    s.min_quantity,
    s.max_quantity,
    s.min_current_price,
    s.max_current_price,
    coalesce(s.explicit_close_price_rows, 0)::int
      as explicit_close_price_rows,
    coalesce(s.explicit_unit_price_rows, 0)::int as explicit_unit_price_rows,
    coalesce(s.value_formula_mismatch_rows, 0)::int
      as value_formula_mismatch_rows,
    coalesce(e.event_rows, 0)::int as event_rows,
    e.event_start_date,
    e.event_end_date,
    coalesce(e.event_type_count, 0)::int as event_type_count,
    coalesce(e.event_price_rows, 0)::int as event_price_rows,
    coalesce(e.event_quantity_rows, 0)::int as event_quantity_rows,
    case
      when ${FOUNT_INSTRUMENT_PREDICATE}
        then 'not_required_product_owner_excluded'
      when i.asset_type = 'commodity'
        and coalesce(s.official_gold_close_candidate_rows, 0) > 0
        then 'official_close_candidate_rows_not_authority_instrument_binding_required'
      when i.asset_type = 'commodity'
        and coalesce(s.legacy_close_label_rows, 0) > 0
        then 'legacy_close_label_without_official_source_or_instrument_binding'
      when i.asset_type = 'commodity'
        then 'official_close_evidence_missing'
      when i.ticker is null
        and coalesce(s.legacy_close_label_rows, 0) > 0
        then 'legacy_close_label_without_product_or_provider_authority'
      when i.ticker is null
        then 'product_and_valuation_authority_required'
      else 'not_applicable_listed_instrument'
    end as stored_series_authority,
    case
      when ${FOUNT_INSTRUMENT_PREDICATE}
        then 'not_required_product_owner_excluded'
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
  left join event_series_summary e on e.legacy_asset_id = i.legacy_asset_id
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
        and not (${GOLD_POSITION_PREDICATE})
        and not (${FOUNT_POSITION_PREDICATE})
    )::int as unresolved_identity_rows,
    count(*) filter (
      where resolved_ticker is null and ${GOLD_POSITION_PREDICATE}
    )::int as separate_model_rows,
    count(*) filter (
      where resolved_ticker is null and ${FOUNT_POSITION_PREDICATE}
    )::int as intentionally_excluded_rows,
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
  from anchor_positions p
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

const FOUNT_EXCLUSION_PARITY_SQL = `
  with named_portfolio_rows as (
    select snapshot_date, account, source, total_market_value
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
  fount_rows as (
    select
      h.snapshot_date,
      h.account,
      h.source,
      count(*)::int as row_count,
      sum(h.market_value_krw) as excluded_market_value_krw,
      count(*) filter (
        where h.market_value_krw is null or h.market_value_krw < 0
      )::int as invalid_value_rows
    from daily_position_snapshots h
    where h.is_sample = false
      and nullif(btrim(h.ticker), '') is null
      and ${FOUNT_HISTORY_PREDICATE}
    group by h.snapshot_date, h.account, h.source
  ),
  target_rows as (
    select
      p.snapshot_date,
      p.source,
      p.total_market_value,
      coalesce(f.row_count, 0)::int as excluded_row_count,
      f.excluded_market_value_krw,
      coalesce(f.invalid_value_rows, 0)::int as invalid_value_rows
    from named_portfolio_rows p
    join complete_portfolio_dates d on d.snapshot_date = p.snapshot_date
    cross join anchor a
    left join fount_rows f
      on f.snapshot_date = p.snapshot_date
      and f.account = p.account
      and f.source = p.source
    where p.account = ${sqlLiteral(fountDecision.account)}
      and p.snapshot_date >= a.snapshot_date
  )
  select
    min(snapshot_date)::text as start_date,
    max(snapshot_date)::text as end_date,
    count(*)::int as complete_portfolio_dates,
    count(*) filter (where excluded_row_count = 1)::int
      as exact_source_position_dates,
    count(*) filter (where excluded_row_count = 0)::int
      as missing_position_dates,
    coalesce(
      json_agg(
        json_build_object(
          'snapshotDate', snapshot_date::text,
          'source', source,
          'portfolioValueKrw', total_market_value
        )
        order by snapshot_date
      ) filter (where excluded_row_count = 0),
      '[]'::json
    ) as missing_position_evidence,
    count(*) filter (where excluded_row_count > 1)::int
      as duplicate_position_dates,
    sum(invalid_value_rows)::int as invalid_value_rows,
    count(*) filter (
      where excluded_market_value_krw > total_market_value
    )::int as invalid_subtraction_dates,
    (
      select count(*)::int
      from event_ledger_entries e
      where e.is_sample = false and ${FOUNT_EVENT_PREDICATE}
    ) as event_rows
  from target_rows
`;

const [
  summaryRows,
  instrumentRows,
  sourceRows,
  candidateRows,
  fountExclusionParityRows,
] = await Promise.all([
  sql.query(SUMMARY_SQL),
  sql.query(ANCHOR_SQL),
  sql.query(SOURCE_SQL),
  sql.query(CANDIDATE_SQL),
  sql.query(FOUNT_EXCLUSION_PARITY_SQL),
]);

const summary = summaryRows[0] ?? null;
const fountExclusionParity = fountExclusionParityRows[0] ?? null;
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
  (row) => row.identity_status === "unavailable",
);
if (unavailableIdentityRows.length > 0) {
  blockers.push("tickerless_anchor_holding");
}
if (
  instrumentRows.some(
    (row) => row.classification === "physical_commodity_position",
  )
) {
  blockers.push("physical_anchor_holding_history_unavailable");
  blockers.push("commodity_official_close_authority_unavailable");
}
if (
  unavailableIdentityRows.some((row) => row.classification === "unresolved")
) {
  blockers.push("anchor_holding_classification_unresolved");
  blockers.push("tickerless_noncommodity_product_authority_unresolved");
}
if (
  instrumentRows.some(
    (row) => row.historical_authority_outcome === "intentionally_excluded",
  )
) {
  blockers.push("excluded_holding_scope_transform_required");
}
if (
  !fountExclusionParity ||
  Number(fountExclusionParity.complete_portfolio_dates ?? 0) === 0 ||
  Number(fountExclusionParity.missing_position_dates ?? 0) > 0 ||
  Number(fountExclusionParity.duplicate_position_dates ?? 0) > 0 ||
  Number(fountExclusionParity.invalid_value_rows ?? 0) > 0 ||
  Number(fountExclusionParity.invalid_subtraction_dates ?? 0) > 0 ||
  Number(fountExclusionParity.event_rows ?? 0) > 0
) {
  blockers.push("fount_exclusion_parity_unavailable");
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
    exclusions:
      "explicit_product_owner_exclusion_requires_scope_consistent_actual_and_scenario_transform",
  },
  summary,
  sourceEvidence: sourceRows,
  candidateAnchors: candidateRows,
  fountExclusionParity,
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
          fountExclusionParity: report.fountExclusionParity,
          specialHoldingAuthority: report.specialHoldingAuthority,
          blockers: report.blockers,
          boundaries: report.boundaries,
        }
      : report,
    null,
    2,
  ),
);
