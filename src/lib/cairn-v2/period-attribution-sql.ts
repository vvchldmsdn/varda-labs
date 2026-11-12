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

export const ATTRIBUTION_ENDS_SQL = `
with owned as (
  select a.id,a.code,a.canonical_owner_user_id, ${holdingsPortfolioSql("a")} as holdings
  from public.accounts a where ${ownedActiveAccount}
), candidates as (
  select snapshot.id,snapshot.account_id,snapshot.account,snapshot.canonical_owner_user_id,
    snapshot.snapshot_date,snapshot.source,snapshot.native_evidence,snapshot.captured_at,snapshot.created_at,
    snapshot.description,snapshot.num_assets,case
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
)
select c.account_id::text as account_id,c.valued_on::text as date,c.source,
  case when c.source='varda_manual_daily_snapshot' and coalesce(c.description,'') not like '%snapshot_status=complete%' then null
    else c.num_assets end as expected_positions,
  c.native_evidence->'frame'->>'at' as frame_at,c.native_evidence->'frame'->'scopeComplete' as frame_complete,
  c.native_evidence->'fx' as native_fx,
  case when c.native_evidence is not null then (
    select jsonb_agg(jsonb_build_object('id',p->>'id','accountId',p->>'accountId','ownerId',p->>'ownerId',
        'name',p->>'name','ticker',p->>'ticker','market',p->>'market',
        'observation',p->'observation','unsupportedReason',p->>'unsupportedReason','evidenceReason',p->>'evidenceReason'))
    from jsonb_array_elements(c.native_evidence->'frame'->'positions') p where p->>'kind' is distinct from 'cash'
  ) else (
    select jsonb_agg(jsonb_build_object('assetId',coalesce(snapshot.asset_id,legacy.id),'name',snapshot.asset_name,
        'ticker',snapshot.ticker,'market',snapshot.market,'currency',snapshot.currency,'quantity',
          coalesce(snapshot.quantity,case when coalesce(snapshot.estimated_fractional_quantity,0)=0 then snapshot.total_quantity end),
        'price',case when snapshot.price_basis='manual_current' then
          case when snapshot.source='varda_manual_daily_snapshot' and snapshot.price_source='${MANUAL_ASSET_PRICE_POLICY.source}' and snapshot.quantity>0
            and snapshot.description ~ '(^|; )price_timestamp_basis=manual_input(;|$)'
            and snapshot.description not like '%manual_carry_snapshot=%'
            and coalesce(snapshot.reference_date,snapshot.price_date)::text=left(manual.observed_at,10)
            and manual.observed_at>=to_char((snapshot.cycle_end_at-interval '24 hours') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            and manual.observed_at<to_char(snapshot.cycle_end_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            and manual.observed_at<=to_char(snapshot.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            then snapshot.unit_price end
          when snapshot.price_basis in ('confirmed_manual_total','preserved_stored_manual_carry','preserved_manual_observation') or snapshot.price_source='user_confirmed_total_valuation' then null
          else coalesce(snapshot.unit_price,snapshot.current_price,snapshot.close_price) end,
        'fxRate',snapshot.fx_rate,'fixedKrw',snapshot.fractional_krw_value,'marketValueKrw',snapshot.market_value_krw)
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
from picked c order by c.account_id,c.valued_on`;

// Native revisions replace raw event rows. Fees, transfers and cash deposits never create holding legs.
// A split or corrected legacy trade with uncertain economics is retained as an unpriced leg.
export const ATTRIBUTION_TRADES_SQL = `
with owned as (${ownedAccounts}), events as (
  select a.id as account_id,
    case when e.broker_recovery_data->>'executedAt' is not null then
      (((e.broker_recovery_data->>'executedAt')::timestamptz at time zone 'Asia/Seoul')-interval '7 hours')::date
      else e.event_date end as valued_on,
    e.event_type,coalesce(e.asset_id,h.id) as asset_id,e.quantity_delta,e.price,e.fx_rate,e.amount_krw,
    e.asset_name as name,e.ticker,h.market,h.currency,
    e.broker_recovery_data->'executionGross' as gross,
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
    null::jsonb,false,ev-'source'-'memo'
  from owned a join public.effective_native_ledger_entries e on e.account_id=a.id and e.canonical_owner_user_id=a.canonical_owner_user_id
  cross join lateral(select e.native_data->'event' as ev) n
  left join public.assets linked on linked.id::text=ev->>'assetId' and linked.account_id=a.id
    and linked.canonical_owner_user_id=a.canonical_owner_user_id
  where ev->>'type' in ('buy','sell','split')
)
select account_id::text,valued_on::text as date,event_type,asset_id::text,quantity_delta::text,price::text,
  fx_rate::text,amount_krw::text,name,ticker,market,currency,gross,uncertain,native_event from events
where valued_on between $2::date and $3::date order by account_id,valued_on`;
