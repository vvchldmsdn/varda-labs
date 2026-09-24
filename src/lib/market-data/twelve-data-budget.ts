import "server-only";
import { createHash } from "node:crypto";
import { sqlClient } from "@/db/client";
import { MARKET_COLLECTION_POLICY } from "@/lib/market-data/collection-policy";

import { assertTwelveDataBudgetPolicy, type TwelveDataBudgetPolicy } from "./twelve-data-budget-policy";
export { assertTwelveDataBudgetPolicy, type TwelveDataBudgetPolicy } from "./twelve-data-budget-policy";
export type TwelveDataReservationResult = Readonly<{
  status: "granted" | "duplicate" | "expired" | "limited";
  retryAfterSeconds: number;
}>;
export type TwelveDataRequestCost = Readonly<{ httpRequests: number; apiCredits: number }>;

/** The shared credential scope deliberately excludes tenant, audience, ticker and license scope. */
export function twelveDataBudgetScope(apiKey: string) {
  if (!apiKey.trim()) throw new Error("twelve_data_budget_scope_invalid");
  return createHash("sha256").update(`twelve_data\0${apiKey}`).digest("hex");
}

/** The timestamp is part of the opaque ID; replay cannot extend its admission lifetime. */
export function twelveDataReservationId(claimToken: string, slot: number, issuedAt = new Date()) {
  if (!/^[a-f0-9-]{36}$/i.test(claimToken) || !Number.isSafeInteger(slot) || slot < 0 || slot > 100 ||
      !Number.isSafeInteger(issuedAt.getTime()) || issuedAt.getTime() < 0 || issuedAt.getTime() > 0xffffffffffff) {
    throw new Error("twelve_data_reservation_invalid");
  }
  const timestamp = issuedAt.getTime().toString(16).padStart(12, "0");
  return timestamp + createHash("sha256").update(`${claimToken}\0${slot}\0${timestamp}`).digest("hex").slice(0, 52);
}

/** Atomic, conservative reservation before transport. A duplicate never authorizes another HTTP call. */
export async function reserveTwelveDataRequest(scopeHash: string, reservationId: string, cost: TwelveDataRequestCost, policy: TwelveDataBudgetPolicy): Promise<TwelveDataReservationResult> {
  assertTwelveDataBudgetPolicy(policy);
  if (!/^[a-f0-9]{64}$/.test(scopeHash) || !/^[a-f0-9]{64}$/.test(reservationId) ||
      !Number.isSafeInteger(cost.httpRequests) || cost.httpRequests < 1 || cost.httpRequests > 100 ||
      !Number.isSafeInteger(cost.apiCredits) || cost.apiCredits < 1 || cost.apiCredits > 100_000) {
    throw new Error("twelve_data_reservation_invalid");
  }
  const issuedAt = new Date(Number.parseInt(reservationId.slice(0, 12), 16)).toISOString();
  const results = await sqlClient.transaction((tx) => [
    tx.query("set local lock_timeout = '2s'"),
    tx.query("set local statement_timeout = '8s'"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`cairn.twelve_data_budget.${scopeHash}`]),
    tx.query("insert into market_provider_budgets(scope_hash,provider) values($1,'twelve_data') on conflict do nothing", [scopeHash]),
    // Admission expires after the existing job lease. Older rows can therefore be pruned without permitting replay.
    tx.query(`delete from market_provider_reservations where (scope_hash,reservation_id) in (
      select scope_hash,reservation_id from market_provider_reservations
      where scope_hash=$1 and reserved_at<clock_timestamp()-interval '1 day' order by reserved_at limit 500)`, [scopeHash]),
    tx.query(RESERVE_SQL, [scopeHash, reservationId, issuedAt, cost.httpRequests, cost.apiCredits,
      policy.httpRequestsPerMinute, policy.apiCreditsPerMinute, policy.minimumIntervalMs, MARKET_COLLECTION_POLICY.jobLeaseSeconds]),
  ], { isolationLevel: "ReadCommitted" });
  const row = results[5]?.[0];
  if (!row || !["granted", "duplicate", "expired", "limited"].includes(String(row.status))) throw new Error("twelve_data_budget_unavailable");
  return { status: row.status as TwelveDataReservationResult["status"], retryAfterSeconds: Number(row.retry_after_seconds) };
}

/** Fixed, non-sensitive codes only; provider response bodies and credentials never enter the ledger. */
export async function coolDownTwelveData(scopeHash: string, code: "rate_limited" | "transport_error" | "auth_failed") {
  if (!/^[a-f0-9]{64}$/.test(scopeHash)) throw new Error("twelve_data_budget_scope_invalid");
  const rows = await sqlClient.query(`update market_provider_budgets set
    failure_count=least(failure_count+1,10),
    blocked_until=greatest(blocked_until,clock_timestamp()+make_interval(secs=>
      case when $2='auth_failed' then 3600 else least(3600,15*power(2,least(failure_count,8))::integer) end)),
    limited_count=limited_count+case when $2='rate_limited' then 1 else 0 end,
    last_code=$2,updated_at=clock_timestamp()
    where scope_hash=$1 and provider='twelve_data'
    returning greatest(1,ceil(extract(epoch from blocked_until-clock_timestamp())))::integer as retry_after_seconds`, [scopeHash, code]);
  return Number(rows[0]?.retry_after_seconds ?? 60);
}

export async function markTwelveDataSuccess(scopeHash: string) {
  if (!/^[a-f0-9]{64}$/.test(scopeHash)) throw new Error("twelve_data_budget_scope_invalid");
  // Do not clear another in-flight request's cooldown.
  await sqlClient.query(`update market_provider_budgets set failure_count=0,last_code='ok',updated_at=clock_timestamp()
    where scope_hash=$1 and provider='twelve_data' and blocked_until<=clock_timestamp()`, [scopeHash]);
}

export async function getTwelveDataBudgetSummary() {
  const [row] = await sqlClient.query(`select coalesce(sum(request_count),0)::bigint as reserved_http_requests,
    coalesce(sum(credit_count),0)::bigint as reserved_api_credits,
    coalesce(sum(limited_count),0)::bigint as limited,
    count(*) filter(where blocked_until>now())::integer as blocked_scopes
    from market_provider_budgets where provider='twelve_data'`);
  return { reservedHttpRequests: Number(row?.reserved_http_requests ?? 0), reservedApiCredits: Number(row?.reserved_api_credits ?? 0),
    limited: Number(row?.limited ?? 0), blockedScopes: Number(row?.blocked_scopes ?? 0) };
}

const RESERVE_SQL = `with clock as materialized (
  select clock_timestamp() as at
), current as materialized (
  select b.*,c.at,date_trunc('minute',c.at) as minute,
    exists(select 1 from market_provider_reservations r where r.scope_hash=$1 and r.reservation_id=$2) as replay,
    $3::timestamptz <= c.at and $3::timestamptz > c.at-make_interval(secs=>$9::integer) as valid_age,
    greatest(b.blocked_until,b.next_allowed_at,
      case when (case when b.window_started_at>=date_trunc('minute',c.at) then b.window_requests else 0 end)+$4::integer>$6::integer or
        (case when b.window_started_at>=date_trunc('minute',c.at) then b.window_credits else 0 end)+$5::integer>$7::integer
      then date_trunc('minute',c.at)+interval '1 minute' else c.at end) as until_at
  from market_provider_budgets b cross join clock c where b.scope_hash=$1 and b.provider='twelve_data' for update of b
), decision as materialized (
  select *,case when not valid_age then 'expired' when replay then 'duplicate' when until_at>at then 'limited' else 'granted' end as status
  from current
), receipt as (
  insert into market_provider_reservations(scope_hash,reservation_id,http_requests,api_credits)
  select $1,$2,$4::integer,$5::integer from decision where status='granted' returning scope_hash
), written as (
  update market_provider_budgets b set
    window_started_at=case when d.status='granted' then d.minute else b.window_started_at end,
    window_requests=case when d.status='granted' then (case when b.window_started_at>=d.minute then b.window_requests else 0 end)+$4::integer else b.window_requests end,
    window_credits=case when d.status='granted' then (case when b.window_started_at>=d.minute then b.window_credits else 0 end)+$5::integer else b.window_credits end,
    request_count=b.request_count+case when d.status='granted' then $4::integer else 0 end,
    credit_count=b.credit_count+case when d.status='granted' then $5::integer else 0 end,
    limited_count=b.limited_count+case when d.status='limited' then 1 else 0 end,
    next_allowed_at=case when d.status='granted' then d.at+($8::integer*interval '1 millisecond') else b.next_allowed_at end,
    updated_at=d.at
  from decision d where b.scope_hash=d.scope_hash and (d.status<>'granted' or exists(select 1 from receipt)) returning b.scope_hash
) select status,case when status='limited' then greatest(1,ceil(extract(epoch from until_at-at)))::integer else 0 end as retry_after_seconds from decision`;
