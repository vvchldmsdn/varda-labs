import "server-only";
import { createHash } from "node:crypto";
import { sqlClient } from "@/db/client";
import type { ClaimedCollectionJob } from "./collection-queue";
import { assertWritableProvenance, resolveTwelveDataJobInput, twelveDataCollectionDataset, normalizeHistoricalFxInstant, type TwelveDataCollectionConfig, type TwelveDataCollectionPayload } from "./twelve-data-collection";
import { twelveDataConfigAllows, type TwelveDataServiceConfig } from "./twelve-data-config";
import { assertDateWindow, assertActionDateWindow, twelveDataExchangeDate, resolveTwelveDataListing, type TwelveDataListing } from "./providers/twelve-data-contract";
import type { PriceLookupTarget } from "./providers/types";

export type TwelveDataEvidenceQuery = { kind: "live" | "history" | "fx"; target?: PriceLookupTarget; startDate?: string; endDate?: string; asOf: string; knownAt?: string; requestedAt?: string };
export type ProviderStoredPrice = { instrumentKey: string; ticker: string; micCode: string; exchange: string; value: string; currency: "USD"; observedAt: string | null; exchangeDate: string | null; fetchedAt: string; source: "twelve_data"; basis: "raw"; session: "regular" };
export type ProviderStoredFx = { baseCurrency: "USD"; quoteCurrency: "KRW"; rate: string; observedAt: string; fetchedAt: string; source: "twelve_data"; kind: "spot" };
export type ProviderStoredHistoricalFx = Omit<ProviderStoredFx, "kind"> & { kind: "historical_spot"; requestedAt: string };
export type TwelveDataHistoricalFxQuery = { requestedAt: readonly string[]; asOf: string; knownAt?: string };
export type TwelveDataHistoricalFxEvidence = { status: "disabled" | "missing" | "partial" | "admitted"; fx: ProviderStoredHistoricalFx[]; missingAt: string[]; conflictAt: string[] };
export type ProviderStoredAction = { type: "split" | "dividend"; date: string; fromFactor: string | null; toFactor: string | null; cashAmount: string | null; currency: "USD" | null; fetchedAt: string; source: "twelve_data" };
export type TwelveDataSplitRiskQuery = { target: PriceLookupTarget; startDate: string; endDate: string; asOf: string };
export type TwelveDataSplitRisk = { status: "disabled" | "unknown" | "provisional" | "admitted" | "conflict"; actions: ProviderStoredAction[]; refreshDue?: boolean };
export type TwelveDataEvidence = { status: "disabled" | "missing" | "stale" | "conflict" | "admitted"; prices: ProviderStoredPrice[]; fx: (ProviderStoredFx | ProviderStoredHistoricalFx)[]; corporateActions: ProviderStoredAction[]; corporateActionCoverage: "unknown" | "complete"; analysisEligible: boolean; analysisReason?: "corporate_actions_unknown" | "corporate_action_adjustment_required"; refreshDue: boolean };
const datasets = { live: "us_quote", history: "us_daily_raw", fx: "usd_krw" } as const;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const instant = (value: unknown) => value instanceof Date ? value : new Date(String(value));
const iso = (value: unknown) => instant(value).toISOString();
const day = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error("provider_calendar_date_invalid");
  return value;
};
const empty = (status: TwelveDataEvidence["status"]): TwelveDataEvidence => ({ status, prices: [], fx: [], corporateActions: [], corporateActionCoverage: "unknown", analysisEligible: false, refreshDue: status === "missing" || status === "stale" });
const identity = (listing: TwelveDataListing | null) => hash(listing ? [listing.instrumentKey, listing.symbol, listing.micCode, listing.exchange, listing.type, listing.currency, listing.exchangeTimezone] : ["USD", "KRW"]);
const scope = (config: TwelveDataServiceConfig) => hash(["twelve_data", config.provider.audience, config.provider.license.reference, config.provider.license.cacheScope, config.provider.license.quoteDelay]);
const collectionConfig = (config: TwelveDataServiceConfig): TwelveDataCollectionConfig => ({ ...config, isFresh: async () => false, persist: async () => "stale_claim" });
const fence = "exists(select 1 from market_collection_jobs where key=$1 and claim_token=$2::uuid and status='running' and leased_until>clock_timestamp())";

/** Widening request windows must not make an older provisional response authoritative. */
function latestCoveragePerDay(rows: Record<string, unknown>[], start: string, end: string) {
  const newest = [...rows].sort((a, b) => instant(b.fetched_at ?? b.coverage_fetched_at).getTime() - instant(a.fetched_at ?? a.coverage_fetched_at).getTime() || String(a.coverage_key).localeCompare(String(b.coverage_key)));
  const selected = new Map<string, Record<string, unknown>>();
  for (let at = Date.parse(start); at <= Date.parse(end); at += 86400000) {
    const date = new Date(at).toISOString().slice(0, 10);
    const row = newest.find(row => day(row.start_date) <= date && day(row.end_date) >= date);
    if (row) selected.set(date, row);
  }
  return selected;
}

/** Server worker only. A row lock and every write share the same fenced transaction. */
export async function persistTwelveDataEvidence(job: ClaimedCollectionJob, payload: TwelveDataCollectionPayload, config: TwelveDataServiceConfig) {
  if (!twelveDataConfigAllows(config, payload.dataset)) throw new Error("twelve_data_release_not_authorized");
  const workerConfig = collectionConfig(config), input = resolveTwelveDataJobInput(job, workerConfig);
  if (twelveDataCollectionDataset(input) !== payload.dataset) throw new Error("twelve_data_identity_invalid");
  if (payload.dataset === "us_daily_raw" && (Boolean(payload.actionsOnly) !== (input.kind === "history" && Boolean(input.actionsOnly)))) throw new Error("twelve_data_identity_invalid");
  if (payload.dataset === "usd_krw_history" && (input.kind !== "fx" || input.requestedAt !== payload.rate.requestedAt.toISOString())) throw new Error("twelve_data_identity_invalid");
  assertWritableProvenance(payload, workerConfig);
  const listing = input.kind === "fx" ? null : resolveTwelveDataListing(input.target, config.provider.listings);
  if ("listing" in payload && JSON.stringify(payload.listing) !== JSON.stringify(listing)) throw new Error("twelve_data_identity_invalid");
  const scopeKey = scope(config), identityKey = identity(listing);
  const rows = ("rate" in payload ? [payload.rate] : payload.rows).map(row => {
    const p = row.provenance;
    if (p.exchangeDate && (!job.startDate || !job.endDate || p.exchangeDate < job.startDate || p.exchangeDate > job.endDate)) throw new Error("twelve_data_history_date_invalid");
    const requestedAt = payload.dataset === "usd_krw_history" ? payload.rate.requestedAt.toISOString() : null;
    return { observation_key: hash([scopeKey, identityKey, payload.dataset, requestedAt ?? p.observedAt?.toISOString() ?? p.exchangeDate]), scope_key: scopeKey,
      identity_key: identityKey, provider: "twelve_data", license_scope: p.licenseScope, audience: config.provider.audience, contract_version: p.contractVersion,
      dataset: payload.dataset, instrument_key: listing?.instrumentKey ?? null, ticker: listing?.ticker ?? "USD", mic_code: listing?.micCode ?? null,
      exchange: listing?.exchange ?? null, instrument_type: listing?.type ?? null, currency: "USD", quote_currency: "rate" in payload ? "KRW" : null,
      value: "rate" in row ? row.rate : "price" in row ? row.price : row.closePrice, price_basis: p.priceBasis, adjustment: p.adjustment, session: p.session,
      observed_at: p.observedAt?.toISOString() ?? null, requested_at: requestedAt, exchange_date: p.exchangeDate, fetched_at: p.fetchedAt.toISOString(), last_fetched_at: p.fetchedAt.toISOString(),
      expires_at: new Date(p.fetchedAt.getTime() + config.storage.retentionSeconds * 1000).toISOString(), source: "twelve_data", synthetic: false, status: "ok" };
  });
  const coverages: Record<string, unknown>[] = [], events: Record<string, unknown>[] = [];
  if (payload.dataset === "us_daily_raw") for (const type of ["split", "dividend"] as const) {
    const supplied = payload.actions?.filter(c => c.type === type) ?? [];
    if (supplied.length > 1) throw new Error("twelve_data_provenance_invalid");
    const c = supplied[0];
    if (c && (!twelveDataConfigAllows(config, type === "split" ? "us_splits" : "us_dividends") || c.startDate !== job.startDate || c.endDate !== job.endDate || c.events.some(e => e.type !== type || e.date < job.startDate! || e.date > job.endDate!))) throw new Error("twelve_data_provenance_invalid");
    if (payload.actionsOnly && !c) continue;
    const fetched = c?.fetchedAt ?? payload.rows[0].provenance.fetchedAt;
    // Action-only responses are immutable knowledge versions. A delayed event can
    // supersede provisional coverage without changing a previously stored snapshot.
    const key = hash([scopeKey, identityKey, type, job.startDate, job.endDate, ...(payload.actionsOnly ? [fetched.toISOString()] : [])]);
    coverages.push({ coverage_key: key, scope_key: scopeKey, identity_key: identityKey, instrument_key: listing!.instrumentKey, ticker: listing!.ticker, mic_code: listing!.micCode,
      action_type: type, start_date: job.startDate, end_date: job.endDate, status: c ? "complete" : "unknown", source: "twelve_data", source_endpoint: c?.endpoint ?? null,
      source_meaning: c?.sourceMeaning ?? "not_collected", response_hash: c ? hash(c.events) : null, fetched_at: fetched.toISOString(), last_fetched_at: fetched.toISOString(),
      expires_at: new Date(fetched.getTime() + config.storage.retentionSeconds * 1000).toISOString(), synthetic: false });
    for (const event of c?.events ?? []) events.push({ action_key: hash([key, event]), coverage_key: key, event_key: hash(event), action_type: type, effective_date: event.date,
      from_factor: event.type === "split" ? event.fromFactor : null, to_factor: event.type === "split" ? event.toFactor : null,
      cash_amount: event.type === "dividend" ? event.cashAmount : null, currency: event.type === "dividend" ? event.currency : null, fetched_at: fetched.toISOString() });
  }
  const results = await sqlClient.transaction(tx => [
    tx.query(`with locked as (select key from market_collection_jobs where key=$1 and claim_token=$2::uuid and status='running' and leased_until>clock_timestamp() for update)
      select exists(select 1 from locked) as claim_valid,set_config('cairn.twelve_data_claim',case when exists(select 1 from locked) then 'yes' else 'no' end,true)`, [job.key, job.claimToken]),
    tx.query(`delete from market_provider_observations where observation_key in(select observation_key from market_provider_observations where scope_key=$3 and expires_at<=clock_timestamp() limit 500) and ${fence}`, [job.key, job.claimToken, scopeKey]),
    tx.query(`delete from market_provider_action_coverage where coverage_key in(select coverage_key from market_provider_action_coverage where scope_key=$3 and expires_at<=clock_timestamp() limit 10) and ${fence}`, [job.key, job.claimToken, scopeKey]),
    tx.query(`insert into market_provider_observations select r.* from jsonb_populate_recordset(null::market_provider_observations,$3::jsonb) r where ${fence}
      on conflict(observation_key) do update set last_fetched_at=greatest(market_provider_observations.last_fetched_at,excluded.last_fetched_at),
      status=case when market_provider_observations.value=excluded.value and market_provider_observations.observed_at is not distinct from excluded.observed_at then market_provider_observations.status else 'conflict' end returning status`, [job.key, job.claimToken, JSON.stringify(rows)]),
    tx.query(`insert into market_provider_action_coverage select r.* from jsonb_populate_recordset(null::market_provider_action_coverage,$3::jsonb) r where ${fence}
      on conflict(coverage_key) do update set last_fetched_at=greatest(market_provider_action_coverage.last_fetched_at,excluded.last_fetched_at),
      status=case when market_provider_action_coverage.status='unknown' then excluded.status when excluded.status='unknown' then market_provider_action_coverage.status when market_provider_action_coverage.response_hash=excluded.response_hash then market_provider_action_coverage.status else 'conflict' end,
      source_endpoint=case when market_provider_action_coverage.status='unknown' then excluded.source_endpoint else market_provider_action_coverage.source_endpoint end,
      source_meaning=case when market_provider_action_coverage.status='unknown' then excluded.source_meaning else market_provider_action_coverage.source_meaning end,
      response_hash=case when market_provider_action_coverage.status='unknown' then excluded.response_hash else market_provider_action_coverage.response_hash end,
      fetched_at=case when market_provider_action_coverage.status='unknown' then excluded.fetched_at else market_provider_action_coverage.fetched_at end,
      expires_at=case when market_provider_action_coverage.status='unknown' then excluded.expires_at else market_provider_action_coverage.expires_at end returning status`, [job.key, job.claimToken, JSON.stringify(coverages)]),
    tx.query(`insert into market_provider_corporate_actions select r.* from jsonb_populate_recordset(null::market_provider_corporate_actions,$3::jsonb) r where ${fence}
      and exists(select 1 from market_provider_action_coverage c where c.coverage_key=r.coverage_key and c.status='complete') on conflict(action_key) do nothing`, [job.key, job.claimToken, JSON.stringify(events)]),
    // If a lease expires partway through, abort every write instead of committing only some datasets.
    tx.query(`select cast(case when current_setting('cairn.twelve_data_claim',true)='yes' and not (${fence}) then 'twelve_data_stale_claim' else '1' end as integer)`, [job.key, job.claimToken]),
  ]);
  if (!results[0][0]?.claim_valid || results[3].length !== rows.length) return "stale_claim" as const;
  return [...results[3], ...results[4]].some(row => row.status === "conflict") ? "conflict" as const : "written" as const;
}

/** Exact provider/listing/rights scope only. Reads never fetch, splice legacy sources, or infer missing bars. */
export async function queryTwelveDataEvidence(query: TwelveDataEvidenceQuery, config?: TwelveDataServiceConfig): Promise<TwelveDataEvidence> {
  if (query.kind === "fx" && query.requestedAt) {
    const result = await queryTwelveDataHistoricalFx({ requestedAt: [query.requestedAt], asOf: query.asOf, knownAt: query.knownAt }, config);
    return { ...empty(result.status === "disabled" ? "disabled" : result.conflictAt.length ? "conflict" : result.fx.length ? "admitted" : "missing"), fx: result.fx, refreshDue: result.missingAt.length > 0 };
  }
  if (!twelveDataConfigAllows(config, datasets[query.kind])) return empty("disabled");
  const current = Date.now(), asOf = Date.parse(query.asOf), known = query.knownAt ? Date.parse(query.knownAt) : current;
  if (!Number.isFinite(asOf) || !Number.isFinite(known) || asOf > current || known > current) throw new Error("twelve_data_query_time_invalid");
  const c = config!, listing = query.kind === "fx" ? null : resolveTwelveDataListing(query.target!, c.provider.listings);
  if (query.kind === "history") { assertDateWindow(query.startDate!, query.endDate!, new Date(asOf)); }
  const rows = await sqlClient.query(`select *,exchange_date::text as exchange_day from market_provider_observations where scope_key=$1 and identity_key=$2 and dataset=$3
    and fetched_at<=$4::timestamptz and expires_at>clock_timestamp() and
    (($3='us_daily_raw' and exchange_date between $6::date and $7::date) or ($3<>'us_daily_raw' and observed_at<=$5::timestamptz))
    order by exchange_date asc,observed_at desc limit $8`, [scope(c), identity(listing), datasets[query.kind], new Date(known).toISOString(), new Date(asOf).toISOString(), query.startDate ?? null, query.endDate ?? null, query.kind === "history" ? 731 : 1]);
  if (!rows.length) return empty("missing");
  if (rows.some(row => row.status === "conflict")) return empty("conflict");
  const ttl = query.kind === "history" ? c.storage.historyFreshSeconds : query.kind === "fx" ? c.storage.fxFreshSeconds : c.storage.quoteFreshSeconds;
  const refreshDue = rows.some(row => current - instant(row.last_fetched_at).getTime() > ttl * 1000);
  const result = { ...empty(refreshDue ? "stale" : "admitted"), refreshDue };
  if (query.kind === "fx") result.fx = rows.map(row => ({ baseCurrency: "USD", quoteCurrency: "KRW", rate: String(row.value), observedAt: iso(row.observed_at), fetchedAt: iso(row.fetched_at), source: "twelve_data", kind: "spot" }));
  else result.prices = rows.map(row => ({ instrumentKey: String(row.instrument_key), ticker: String(row.ticker), micCode: String(row.mic_code), exchange: String(row.exchange),
    value: String(row.value), currency: "USD", observedAt: row.observed_at ? iso(row.observed_at) : null, exchangeDate: row.exchange_day == null ? null : String(row.exchange_day),
    fetchedAt: iso(row.fetched_at), source: "twelve_data", basis: "raw", session: "regular" }));
  if (query.kind !== "history") return result;
  const coverage: Record<string, unknown>[] = (await sqlClient.query(`select distinct on(action_type,start_date,end_date) *,start_date::text as start_day,end_date::text as end_day from market_provider_action_coverage where scope_key=$1 and identity_key=$2 and start_date<=$4::date and end_date>=$3::date
    and fetched_at<=$5::timestamptz and expires_at>clock_timestamp() order by action_type,start_date,end_date,fetched_at desc,coverage_key`, [scope(c), identity(listing), query.startDate!, query.endDate!, new Date(known).toISOString()])).map(row => ({...row,start_date:row.start_day,end_date:row.end_day}));
  const selectedByType = new Map((['split', 'dividend'] as const).map(type => [type, latestCoveragePerDay(coverage.filter(row => row.action_type === type), query.startDate!, query.endDate!)]));
  const complete = (["split", "dividend"] as const).every(type => {
    if (!twelveDataConfigAllows(c, type === "split" ? "us_splits" : "us_dividends")) return false;
    const selected = selectedByType.get(type)!;
    return selected.size === (Date.parse(query.endDate!) - Date.parse(query.startDate!)) / 86400000 + 1 &&
      [...selected].every(([date, row]) => row.status === "complete" && twelveDataExchangeDate(instant(row.fetched_at)) > date);
  });
  if (!complete) { result.analysisReason = "corporate_actions_unknown"; return result; }
  const events = await sqlClient.query(`select distinct a.coverage_key,a.event_key,a.action_type,a.effective_date::text as effective_date,a.from_factor,a.to_factor,a.cash_amount,a.currency,min(a.fetched_at) as fetched_at
    from market_provider_corporate_actions a join market_provider_action_coverage c on c.coverage_key=a.coverage_key
    where c.scope_key=$1 and c.identity_key=$2 and c.status='complete' and c.fetched_at<=$5::timestamptz and c.expires_at>clock_timestamp() and c.coverage_key=any($6::text[])
    and a.effective_date between $3::date and $4::date and a.fetched_at<=$5::timestamptz group by a.coverage_key,a.event_key,a.action_type,a.effective_date,a.from_factor,a.to_factor,a.cash_amount,a.currency order by effective_date`,
  [scope(c), identity(listing), query.startDate!, query.endDate!, new Date(known).toISOString(), coverage.map(row => String(row.coverage_key))]);
  result.corporateActionCoverage = "complete";
  result.corporateActions = events.filter(row => selectedByType.get(row.action_type as "split" | "dividend")?.get(day(row.effective_date))?.coverage_key === row.coverage_key).map(row => ({ type: row.action_type as "split" | "dividend", date: day(row.effective_date), fromFactor: row.from_factor == null ? null : String(row.from_factor),
    toFactor: row.to_factor == null ? null : String(row.to_factor), cashAmount: row.cash_amount == null ? null : String(row.cash_amount), currency: row.currency as "USD" | null, fetchedAt: iso(row.fetched_at), source: "twelve_data" }));
  result.analysisEligible = !result.corporateActions.length && !refreshDue;
  if (result.corporateActions.length) result.analysisReason = "corporate_action_adjustment_required";
  return result;
}

/** Exact requested instants, current retention and original collection knowledge are all required. */
export async function queryTwelveDataHistoricalFx(query: TwelveDataHistoricalFxQuery, config?: TwelveDataServiceConfig): Promise<TwelveDataHistoricalFxEvidence> {
  if (!twelveDataConfigAllows(config, "usd_krw_history")) return { status: "disabled", fx: [], missingAt: [], conflictAt: [] };
  const requested = historicalFxInstants(query), known = query.knownAt ?? new Date().toISOString();
  if (!requested.length) return { status: "admitted", fx: [], missingAt: [], conflictAt: [] };
  const rows = await sqlClient.query(`select requested_at,observed_at,fetched_at,value,status from market_provider_observations
    where scope_key=$1 and identity_key=$2 and dataset='usd_krw_history' and provider='twelve_data' and source='twelve_data' and not synthetic
    and requested_at=any($3::timestamptz[]) and fetched_at<=$4::timestamptz and observed_at<=requested_at and expires_at>clock_timestamp()
    order by requested_at`, [scope(config!), identity(null), requested, known]);
  const conflictAt = rows.filter(row => row.status === "conflict").map(row => iso(row.requested_at));
  const fx: ProviderStoredHistoricalFx[] = rows.filter(row => row.status === "ok").map(row => ({ baseCurrency: "USD", quoteCurrency: "KRW", rate: String(row.value),
    observedAt: iso(row.observed_at), fetchedAt: iso(row.fetched_at), requestedAt: iso(row.requested_at), source: "twelve_data", kind: "historical_spot" }));
  const available = new Set([...fx.map(row => row.requestedAt), ...conflictAt]);
  const missingAt = requested.filter(at => !available.has(at));
  return { status: !missingAt.length && !conflictAt.length ? "admitted" : fx.length ? "partial" : "missing", fx, missingAt, conflictAt };
}

export function historicalFxInstants(query: TwelveDataHistoricalFxQuery) {
  const current = Date.now(), asOf = Date.parse(query.asOf), known = query.knownAt ? Date.parse(query.knownAt) : current;
  if (!Number.isFinite(asOf) || !Number.isFinite(known) || asOf > current || known > current || !Array.isArray(query.requestedAt) || query.requestedAt.length > 1000) throw new Error("twelve_data_query_time_invalid");
  const requested = [...new Set(query.requestedAt.map(normalizeHistoricalFxInstant))].sort();
  if (requested.some(at => Date.parse(at) > asOf)) throw new Error("twelve_data_query_time_invalid");
  return requested;
}

/** Only continuous retained coverage proves that recorded quantities match a raw quote's share basis. */
export async function queryTwelveDataSplitRisk(query: TwelveDataSplitRiskQuery, config?: TwelveDataServiceConfig): Promise<TwelveDataSplitRisk> {
  if (!twelveDataConfigAllows(config, "us_splits")) return { status: "disabled", actions: [] };
  const at = Date.parse(query.asOf);
  if (!Number.isFinite(at) || at > Date.now() || !/^\d{4}-\d{2}-\d{2}$/.test(query.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(query.endDate) || query.startDate > query.endDate || Date.parse(query.endDate) > at) throw new Error("twelve_data_query_time_invalid");
  assertActionDateWindow(query.startDate, query.endDate, new Date(at));
  const listing = resolveTwelveDataListing(query.target, config!.provider.listings);
  const rows = await sqlClient.query(`with versions as (
      select *,row_number() over(partition by start_date,end_date order by fetched_at desc,coverage_key) as version_rank
      from market_provider_action_coverage where scope_key=$1 and identity_key=$2 and action_type='split' and source='twelve_data' and not synthetic
        and start_date<=$4::date and end_date>=$3::date and fetched_at<=$5::timestamptz and expires_at>clock_timestamp())
    select c.coverage_key,c.start_date::text as start_date,c.end_date::text as end_date,c.status,c.fetched_at as coverage_fetched_at,c.last_fetched_at,a.event_key,a.effective_date::text as effective_date,a.from_factor,a.to_factor,a.fetched_at
    from versions c left join market_provider_corporate_actions a on a.coverage_key=c.coverage_key and a.action_type='split'
      and a.effective_date between $3::date and $4::date and a.fetched_at<=$5::timestamptz
    where c.version_rank=1
    order by a.effective_date limit 1001`, [scope(config!), identity(listing), query.startDate, query.endDate, query.asOf]);
  if (rows.length > 1000 || rows.some(row => row.status === "conflict")) return { status: "conflict", actions: [] };
  const coverage = [...new Map(rows.map(row => [String(row.coverage_key), { ...row, fetched_at: row.coverage_fetched_at }])).values()];
  const selected = latestCoveragePerDay(coverage, query.startDate, query.endDate);
  const seen = new Set<string>();
  const actions: ProviderStoredAction[] = rows.filter(row => row.status === "complete" && row.event_key && selected.get(day(row.effective_date))?.coverage_key === row.coverage_key && !seen.has(String(row.event_key)) && seen.add(String(row.event_key))).map(row => ({ type: "split", date: day(row.effective_date), fromFactor: String(row.from_factor), toFactor: String(row.to_factor), cashAmount: null, currency: null, fetchedAt: iso(row.fetched_at), source: "twelve_data" }));
  if (selected.size !== (Date.parse(query.endDate) - Date.parse(query.startDate)) / 86400000 + 1 || [...selected.values()].some(row => row.status !== "complete")) return { status: "unknown", actions, refreshDue: true };
  const provisional = [...selected].some(([date, row]) => twelveDataExchangeDate(instant(row.fetched_at)) <= date);
  const refreshDue = [...selected.values()].some(row => Date.now() - instant(row.last_fetched_at).getTime() >= config!.storage.quoteFreshSeconds * 1000) ||
    provisional && query.endDate < twelveDataExchangeDate(new Date());
  return { status: provisional ? "provisional" : "admitted", actions, refreshDue: provisional ? refreshDue : false };
}
