import "server-only";
import { MANUAL_ASSET_PRICE_POLICY } from "../market-data/manual-asset-price";
import { holdingsPortfolioSql } from "../portfolio-presentation-policy";
import { brokerRecoverySnapshotPredicateText } from "./history-read-sql";

// All values are bound parameters. The caller sets this transaction-local owner using the existing tenant port.
const ownedActiveAccount = `a.is_active and a.canonical_owner_user_id=nullif(current_setting('app.current_user_id',true),'')::uuid
    and ($1::uuid is null or a.id=$1::uuid)`;
const ownedAccounts = `select a.id,a.name,a.code,a.canonical_owner_user_id
  from public.accounts a where ${ownedActiveAccount}`;

export const ATTRIBUTION_ACCOUNTS_SQL = ownedAccounts + " order by a.sort_order,a.code";
export const PERFORMANCE_ACCOUNTS_SQL = `select a.id,${holdingsPortfolioSql("a")} as holdings
  from public.accounts a where ${ownedActiveAccount} order by a.id`;

// Bind current marks back to the account, quantity and journal sequence observed
// alongside history. A trade committed between the two reads cannot become P&L.
export const PERFORMANCE_LIVE_SCOPE_SQL = `
select a.id::text as account_id, a.native_state->>'sequence' as sequence,
  a.native_state->>'at' as last_event_at,
  h.id::text as asset_id, h.asset_type, h.currency, h.quantity::text, h.fractional_krw_value::text as fixed_krw
from public.accounts a left join public.assets h on h.account_id=a.id and h.account=a.code
  and h.canonical_owner_user_id=a.canonical_owner_user_id and h.archived_at is null
where ${ownedActiveAccount} order by a.id,h.id`;

// Only the opening value is needed to check whether an overlapping saved close is a usable baseline.
// Restrict to the account's effective recovery revision before comparing dates or amounts.
const recoveryOpeningsSql = `, recovery_openings as (
  select a.id, curve->>'baseDate' as valued_on, curve#>>'{points,0,valueKrw}' as value_krw
  from owned a
  join public.event_ledger_entries e on e.canonical_owner_user_id=a.canonical_owner_user_id and e.account_id=a.id
  join public.native_ledger_revisions r on r.canonical_owner_user_id=a.canonical_owner_user_id and r.account_id=a.id
    and r.operation_id=e.native_operation_id and r.marker_sequence=e.native_sequence
  cross join lateral (select e.native_data->'request'->'returnRecovery' as curve) payload
  where a.holdings and not e.is_sample and e.event_type='native_revision' and e.rule_version='broker_evidence_recovery_v1'
    and e.native_data->'request'->>'kind'='broker_evidence_recovery'
    and curve->>'accountId'=a.id::text and curve->>'revision'=r.marker_sequence::text
    and curve->>'version'='1' and curve->>'basis'='invested_assets_excluding_cash' and curve->>'currency'='KRW'
    and curve#>>'{points,0,date}'=curve->>'baseDate' and jsonb_typeof(curve#>'{points,0,valueKrw}')='number'
    and curve->>'baseDate' between ($2::date-1)::text and $3::date::text
    and not exists(select 1 from public.native_ledger_revisions later where later.account_id=r.account_id
      and later.canonical_owner_user_id=r.canonical_owner_user_id and later.marker_sequence>r.marker_sequence)
)`;

const observedManualUnitSql = `snapshot.source='varda_manual_daily_snapshot' and snapshot.price_source='${MANUAL_ASSET_PRICE_POLICY.source}' and snapshot.quantity>0
  and snapshot.description ~ '(^|; )price_timestamp_basis=manual_input(;|$)'
  and snapshot.description not like '%manual_carry_snapshot=%'
  and coalesce(snapshot.reference_date,snapshot.price_date)::text=left(manual.observed_at,10)
  and manual.observed_at>=to_char((snapshot.cycle_end_at-interval '24 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  and manual.observed_at<to_char(snapshot.cycle_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  and manual.observed_at<=to_char(snapshot.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

function endsSql(performance: boolean) {
  return `
with owned as (
  select a.id,a.code,a.canonical_owner_user_id, ${holdingsPortfolioSql("a")} as holdings
  from public.accounts a where ${ownedActiveAccount}
), candidates as (
  select snapshot.id,snapshot.account_id,snapshot.account,snapshot.canonical_owner_user_id,
    snapshot.snapshot_date,snapshot.source,snapshot.native_evidence,snapshot.captured_at,snapshot.created_at,snapshot.cycle_end_at,
    snapshot.description,snapshot.num_assets,
    ${performance ? "snapshot.usdkrw," : ""}case
    when snapshot.native_evidence is not null then
      (((snapshot.native_evidence->'frame'->>'at')::timestamptz at time zone 'Asia/Seoul')::date-1)
    when snapshot.source='varda_manual_daily_snapshot' or snapshot.source like 'broker_reconstructed_close_v1:%' then
      coalesce((snapshot.cycle_end_at at time zone 'Asia/Seoul')::date,snapshot.snapshot_date)-1
    else snapshot.snapshot_date end as valued_on
  from public.daily_portfolio_snapshots snapshot
  join owned a on a.id=snapshot.account_id and a.canonical_owner_user_id=snapshot.canonical_owner_user_id
    and a.code=snapshot.account
  where not snapshot.is_sample and snapshot.snapshot_date between $2::date-1 and $3::date+1 and (
    (a.holdings and snapshot.native_evidence is null
      and (snapshot.source in ('base44_import','varda_daily_snapshot_v1','varda_manual_daily_snapshot') or snapshot.source like 'broker_reconstructed_close_v1:%')
      and ${brokerRecoverySnapshotPredicateText("snapshot")})
    or (not a.holdings and snapshot.native_evidence->>'version'='1'
      and snapshot.native_evidence->'frame'->>'boundary'='before'
      and jsonb_typeof(snapshot.native_evidence->'frame'->'positions')='array'
      and (snapshot.source='native_ledger_cutoff_v2' or snapshot.source ~ '^native_ledger_cutoff_v3:r[0-9]+$')
      and not exists(select 1 from public.native_ledger_revisions revision
        where revision.canonical_owner_user_id=a.canonical_owner_user_id and revision.account_id=a.id
          and revision.marker_sequence>coalesce((snapshot.native_evidence->>'revision')::int,0)
          and (snapshot.native_evidence->'frame'->>'at')::timestamptz>revision.affected_at))
  )
), picked as (
  select distinct on (account_id,valued_on) * from candidates
  where valued_on between $2::date-1 and $3::date
  order by account_id,valued_on,coalesce((native_evidence->>'revision')::int,0) desc,
    coalesce(captured_at,created_at) desc nulls last,created_at desc,
    case when source='varda_manual_daily_snapshot' then 0 when source='base44_import' then 1 else 2 end,
    source,id
)${performance ? recoveryOpeningsSql : ""}
select c.account_id::text as account_id,c.valued_on::text as date,c.source,
  ${performance ? `c.id::text as snapshot_id,c.captured_at::text as captured_at,opening.value_krw as recovery_opening_krw,
    case when c.source='varda_manual_daily_snapshot' and c.description ~ '(^|; *)valuation_policy=execution_collection_v1(;|$)'
      then c.cycle_end_at::text end as execution_end_at,` : ""}
  case when c.source='varda_manual_daily_snapshot' and coalesce(c.description,'') not like '%snapshot_status=complete%' then null
    else c.num_assets end as expected_positions,
  c.native_evidence->'frame'->>'at' as frame_at,c.native_evidence->'frame'->'scopeComplete' as frame_complete,
  c.native_evidence->'fx' as native_fx,
  ${performance ? `c.native_evidence->'availableCurrencies' as available_currencies,
    case when c.source='varda_manual_daily_snapshot' and c.description ~ '(^|; )fx_source=(fx_rates|daily_valuation_fx)[:@]'
      then c.usdkrw end as portfolio_usd_krw,` : ""}
  case when c.native_evidence is not null then (
    select jsonb_agg(jsonb_build_object('id',p->>'id','accountId',p->>'accountId','ownerId',p->>'ownerId',
        'kind',p->>'kind','name',p->>'name','ticker',p->>'ticker','market',p->>'market',
        'observation',p->'observation','unsupportedReason',p->>'unsupportedReason','evidenceReason',p->>'evidenceReason'))
    from jsonb_array_elements(c.native_evidence->'frame'->'positions') p ${performance ? "" : "where p->>'kind' is distinct from 'cash'"}
  ) else (
    select jsonb_agg(jsonb_build_object('assetId',coalesce(snapshot.asset_id,legacy.id),'currency',snapshot.currency,'quantity',
          coalesce(snapshot.quantity,case when coalesce(snapshot.estimated_fractional_quantity,0)=0 then snapshot.total_quantity end),
        ${performance ? `'fxRate',snapshot.fx_rate,'carriedMark', coalesce(snapshot.description like '%manual_carry_snapshot=%' or
           snapshot.price_basis='preserved_stored_manual_carry'
           or (snapshot.price_basis='manual_current' and not coalesce((${observedManualUnitSql}),false)), false),` :
        `'name',snapshot.asset_name,'ticker',snapshot.ticker,'market',snapshot.market,
        'price',case when snapshot.price_basis='manual_current' then
          case when ${observedManualUnitSql}
            then snapshot.unit_price end
          when snapshot.price_basis in ('confirmed_manual_total','preserved_stored_manual_carry','preserved_manual_observation') or snapshot.price_source='user_confirmed_total_valuation' then null
          else coalesce(snapshot.unit_price,snapshot.current_price,snapshot.close_price) end,
        'fxRate',snapshot.fx_rate,`}
        'fixedKrw',snapshot.fractional_krw_value,'marketValueKrw',snapshot.market_value_krw)
      order by snapshot.asset_name,snapshot.id)
    from public.daily_position_snapshots snapshot
    -- The daily writer records ISO UTC, with milliseconds. Only an explicit unit observation
    -- inside this completed 07:00-to-07:00 cycle qualifies; carrying yesterday's mark is not a quote.
    cross join lateral (select substring(snapshot.description from
      '(?:^|; )price_observed_at=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z)(?:;|$)') as observed_at) manual
    left join public.assets legacy on snapshot.asset_id is null and legacy.legacy_base44_id=snapshot.legacy_asset_id
      and legacy.account_id=snapshot.account_id and legacy.canonical_owner_user_id=snapshot.canonical_owner_user_id
    where snapshot.canonical_owner_user_id=c.canonical_owner_user_id and snapshot.account_id=c.account_id
      and snapshot.account=c.account and snapshot.source=c.source and snapshot.snapshot_date=c.snapshot_date
      and not snapshot.is_sample and ${brokerRecoverySnapshotPredicateText("snapshot", undefined, "daily_position_snapshots")}
      and (c.source like 'broker_reconstructed_close_v1:%' and snapshot.quantity=0
        and snapshot.market_value_krw=0 and snapshot.price_basis='confirmed_zero') is not true
  ) end as positions
from picked c
${performance ? "left join recovery_openings opening on opening.id=c.account_id and opening.valued_on=c.valued_on::text" : ""}
order by c.account_id,c.valued_on`;
}

export const ATTRIBUTION_ENDS_SQL = endsSql(false);
export const PERFORMANCE_ENDS_SQL = endsSql(true);

export const PERFORMANCE_CASH_SQL = `
with owned as (select a.id,a.canonical_owner_user_id from public.accounts a
  where ${ownedActiveAccount} and not ${holdingsPortfolioSql("a")}), events as (
  select e.account_id, e.native_data->'event' as ev, e.native_data->'effect'->'cashLegs' as legs
  from owned a join public.effective_native_ledger_entries e on e.canonical_owner_user_id=a.canonical_owner_user_id and e.account_id=a.id
  where e.native_data->'event'->>'type' in ('deposit','withdraw','transfer')
) select account_id::text, (((ev->>'at')::timestamptz at time zone 'Asia/Seoul')-interval '7 hours')::date::text as date,
  ev->>'at' as at, ev->>'type' as type, ev->>'amount' as amount, ev->>'currency' as currency,
  ev->>'direction' as direction, ev->>'peerAccountId' as peer, ev->>'transferId' as transfer_id,
  ev->'dateEvidence' is not null as date_only, legs from events
  where (ev->>'at')::timestamptz >= ($2::date::timestamp+interval '7 hours') at time zone 'Asia/Seoul'
    and (ev->>'at')::timestamptz < (($3::date+1)::timestamp+interval '7 hours') at time zone 'Asia/Seoul'`;

// Native revisions replace raw event rows. Fees, transfers and cash deposits never create holding legs.
// A split or corrected legacy trade with uncertain economics is retained as an unpriced leg.
function tradesSql(includeFollowingDay: boolean) {
return `
with owned as (${ownedAccounts}), events as (
  select a.id as account_id,
    case when e.broker_recovery_data->>'executedAt' is not null then
      (((e.broker_recovery_data->>'executedAt')::timestamptz at time zone 'Asia/Seoul')-interval '7 hours')::date
      else e.event_date end as valued_on,
    e.event_type,coalesce(e.asset_id,h.id) as asset_id,e.quantity_delta,e.price,e.fx_rate,e.amount_krw,
    e.asset_name as name,e.ticker,h.market,h.currency,
    e.broker_recovery_data->'executionGross' as gross,e.broker_recovery_data->>'executedAt' as executed_at,
    e.corrects_event_id is not null or e.legacy_corrects_event_id is not null or exists (
      select 1 from public.event_ledger_entries correction where correction.account_id=a.id
        and correction.canonical_owner_user_id=a.canonical_owner_user_id and not correction.is_sample
        and (correction.corrects_event_id=e.id or correction.legacy_corrects_event_id=e.legacy_base44_id)
    ) as uncertain,null::jsonb as native_event
  from owned a join public.event_ledger_entries e on e.account_id=a.id and e.canonical_owner_user_id=a.canonical_owner_user_id
  left join public.assets h on h.account_id=a.id and h.canonical_owner_user_id=a.canonical_owner_user_id
    and (h.id=e.asset_id or (e.asset_id is null and h.legacy_base44_id=e.legacy_asset_id))
  where not e.is_sample and e.native_data is null and e.event_date between $2::date-1 and $3::date+1
    and (e.event_type in ('buy','sell','split','native_buy','native_sell') or e.quantity_delta<>0)
  union all
  select a.id,(((ev->>'at')::timestamptz at time zone 'Asia/Seoul')-interval '7 hours')::date,
    ev->>'type',linked.id,null,null,null,null,linked.name,linked.ticker,linked.market,ev->>'currency',
    null::jsonb,ev->>'at',false,ev-'source'-'memo'
  from owned a join public.effective_native_ledger_entries e on e.account_id=a.id and e.canonical_owner_user_id=a.canonical_owner_user_id
  cross join lateral(select e.native_data->'event' as ev) n
  left join public.assets linked on linked.id::text=ev->>'assetId' and linked.account_id=a.id
    and linked.canonical_owner_user_id=a.canonical_owner_user_id
  where ev->>'type' in ('buy','sell','split')
)
select account_id::text,valued_on::text as date,event_type,asset_id::text,quantity_delta::text,price::text,
  fx_rate::text,amount_krw::text,name,ticker,market,currency,gross,executed_at,uncertain,native_event from events
where valued_on between $2::date and $3::date${includeFollowingDay ? "+1" : ""} order by account_id,valued_on`;
}
export const ATTRIBUTION_TRADES_SQL = tradesSql(false);
export const PERFORMANCE_TRADES_SQL = tradesSql(true);
