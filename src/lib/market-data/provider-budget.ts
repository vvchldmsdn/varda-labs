import "server-only";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { sqlClient } from "@/db/client";
const requestDeadline = new AsyncLocalStorage<number>();

export function withKisCollectionDeadline<T>(task: () => Promise<T>) {
  return requestDeadline.run(Date.now() + 45_000, task);
}

export class KisProviderBudgetError extends Error {
  readonly code = "provider_budget_limited";
  constructor(readonly retryAfterSeconds: number) { super("KIS request budget is cooling down"); this.name = "KisProviderBudgetError"; }
}

export function getKisRequestBudgetPolicy(env: Record<string, string | undefined> = process.env) {
  return {
    requestsPerMinute: configuredInteger(env.KIS_REQUESTS_PER_MINUTE, 60, 1, 10_000),
    minimumIntervalMs: configuredInteger(env.KIS_MIN_REQUEST_INTERVAL_MS, 1000, 100, 60_000),
    tokenMinimumIntervalSeconds: configuredInteger(env.KIS_TOKEN_MIN_INTERVAL_SECONDS, 60, 1, 3600),
  };
}

/** All KIS HTTP requests, including OAuth and exchange probes, reserve first. */
export async function fetchKisWithBudget(
  config: { baseUrl: string; appKey: string }, input: string, init: RequestInit,
) {
  const scopeHash = createHash("sha256").update(`${config.baseUrl}\u0000${config.appKey}`).digest("hex");
  const kind = new URL(input).pathname === "/oauth2/tokenP" ? "token" : "price";
  const policy = getKisRequestBudgetPolicy();
  for (let retry = 0; ; retry++) {
    if ((requestDeadline.getStore() ?? Infinity) - Date.now() < 1500) throw new KisProviderBudgetError(10);
    const wait = await reserveKisRequest(scopeHash, kind, policy);
    if (wait === 0) break;
    // Pacing is bounded; a minute budget or provider backoff yields to the durable queue.
    if (wait > 2 || retry >= 2) throw new KisProviderBudgetError(wait);
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
  }
  try {
    const remaining = (requestDeadline.getStore() ?? Date.now() + 12_000) - Date.now();
    if (remaining < 1000) throw new KisProviderBudgetError(10);
    const signal = AbortSignal.timeout(Math.min(12_000, Math.floor(remaining)));
    const response = await fetch(input, { ...init, signal: init.signal ? AbortSignal.any([init.signal, signal]) : signal });
    let limit = response.status === 429;
    // KIS can report EGW00201 as JSON in HTTP 200.
    if (response.ok && response.headers.get("content-type")?.includes("json")) {
      const body = await response.clone().json().catch(() => null) as { msg_cd?: string } | null;
      limit ||= body?.msg_cd === "EGW00201";
    }
    if (limit || response.status >= 500) {
      const retryValue = response.headers.get("retry-after");
      const retryHeader = retryValue && /^\d+$/.test(retryValue) ? Number(retryValue)
        : retryValue ? Math.max(0, Math.ceil((Date.parse(retryValue) - Date.now()) / 1000)) : 0;
      const retryAfter = await recordKisFailure(scopeHash, limit ? "rate_limited" : "provider_unavailable",
        Number.isFinite(retryHeader) && retryHeader > 0 ? Math.min(3600, Math.ceil(retryHeader)) : 0);
      throw new KisProviderBudgetError(retryAfter);
    }
    if (response.ok) await sqlClient.query(`update market_provider_budgets set failure_count=0,last_code='ok',updated_at=clock_timestamp() where scope_hash=$1`, [scopeHash]);
    return response;
  } catch (error) {
    if ((requestDeadline.getStore() ?? Infinity) <= Date.now()) throw new KisProviderBudgetError(10);
    if (!(error instanceof KisProviderBudgetError)) await recordKisFailure(scopeHash, "transport_error", 0);
    throw error;
  }
}

export async function reserveKisRequest(scopeHash: string, kind: "token" | "price", policy = getKisRequestBudgetPolicy()): Promise<number> {
  const results = await sqlClient.transaction((tx) => [
    tx.query("set local lock_timeout = '2s'"),
    tx.query("set local statement_timeout = '8s'"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`varda.kis_budget.${scopeHash}`]),
    tx.query("insert into market_provider_budgets(scope_hash) values($1) on conflict do nothing", [scopeHash]),
    tx.query(RESERVE_SQL, [scopeHash, kind, policy.requestsPerMinute, policy.minimumIntervalMs, policy.tokenMinimumIntervalSeconds]),
  ], { isolationLevel: "ReadCommitted" });
  return Number(results[4]?.[0]?.retry_after_seconds ?? 60);
}

export async function getKisRequestBudgetSummary() {
  const [row] = await sqlClient.query(`select coalesce(sum(request_count),0)::bigint as requests,
    coalesce(sum(limited_count),0)::bigint as limited,
    count(*) filter(where blocked_until>now())::integer as blocked_scopes,
    coalesce(max(extract(epoch from blocked_until-now())) filter(where blocked_until>now()),0)::integer as retry_after_seconds
    from market_provider_budgets`);
  return { requests: Number(row?.requests ?? 0), limited: Number(row?.limited ?? 0), blockedScopes: Number(row?.blocked_scopes ?? 0), retryAfterSeconds: Number(row?.retry_after_seconds ?? 0) };
}

async function recordKisFailure(scopeHash: string, code: string, retryAfterSeconds: number) {
  const rows = await sqlClient.query(`update market_provider_budgets set failure_count=least(failure_count+1,10),
    blocked_until=greatest(blocked_until,clock_timestamp()+make_interval(secs=>greatest($3::integer,least(3600,15*power(2,least(failure_count,8))::integer)+floor(random()*10)::integer))),
    limited_count=limited_count+case when $2='rate_limited' then 1 else 0 end,last_code=$2,updated_at=clock_timestamp()
    where scope_hash=$1 returning greatest(1,ceil(extract(epoch from blocked_until-clock_timestamp())))::integer as wait`, [scopeHash, code, retryAfterSeconds]);
  return Number(rows[0]?.wait ?? 60);
}

const RESERVE_SQL = `with current as materialized (
  select *,greatest(blocked_until,next_allowed_at,
    case when $2='token' then token_next_allowed_at else now() end,
    case when window_started_at > now()-interval '1 minute' and window_requests >= $3::integer then window_started_at+interval '1 minute' else now() end) as until_at
  from market_provider_budgets where scope_hash=$1 for update
), written as (
  update market_provider_budgets b set
    window_started_at=case when c.until_at<=now() and c.window_started_at<=now()-interval '1 minute' then now() else c.window_started_at end,
    window_requests=case when c.until_at<=now() then (case when c.window_started_at<=now()-interval '1 minute' then 0 else c.window_requests end)+1 else c.window_requests end,
    next_allowed_at=case when c.until_at<=now() then now()+($4::integer*interval '1 millisecond') else c.next_allowed_at end,
    token_next_allowed_at=case when c.until_at<=now() and $2='token' then now()+make_interval(secs=>$5::integer) else c.token_next_allowed_at end,
    request_count=c.request_count+case when c.until_at<=now() then 1 else 0 end,
    limited_count=c.limited_count+case when c.until_at>now() then 1 else 0 end,updated_at=now()
  from current c where b.scope_hash=c.scope_hash returning b.scope_hash
) select greatest(0,ceil(extract(epoch from until_at-now())))::integer as retry_after_seconds from current`;

function configuredInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const n = Number(value); return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}
