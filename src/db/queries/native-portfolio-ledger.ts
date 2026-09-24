import "server-only";
import { randomUUID } from "node:crypto";
import { cache } from "react";
import { getTenantSqlClient } from "@/db/tenant-client";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { applyNativeEvent, createNativePortfolioState, type NativeEvent, type NativeOpeningInput, type NativePortfolioState } from "@/lib/native-portfolio-ledger";
import { Decimal, isCurrency } from "@/lib/money";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";

export type NativeStoredAsset = { id: string; quantity: string; currency: string; archived: boolean; name: string; ticker: string | null; market: string; assetType: string | null };
export type NativeStoredAccount = { id: string; name: string; active?: boolean; updatedAt?: string; state: NativePortfolioState | null; assets: NativeStoredAsset[] };
export type NativeStoredEntry = { id: string; accountId: string; operationId: string; data: { request: unknown; event: NativeEvent | { type: "opening"; at: string }; state: NativePortfolioState; effect: { cashLegs: { currency: "KRW" | "USD"; delta: string; kind: string }[] } | null } };
const NATIVE_ACCOUNTS_QUERY = `select a.id,a.name,a.is_active as active,a.updated_at::text as "updatedAt",a.native_state as state,
  coalesce((select jsonb_agg(jsonb_build_object('id',h.id,'quantity',h.quantity::text,'currency',h.currency,'archived',h.archived_at is not null,'name',h.name,'ticker',h.ticker,'market',h.market,'assetType',h.asset_type) order by h.id)
   from assets h where h.account_id=a.id and h.canonical_owner_user_id=$1::uuid),'[]'::jsonb) as assets
  from accounts a where a.canonical_owner_user_id=$1::uuid and (a.is_active or a.native_state is not null)
  and ($2::uuid[] is null or a.id=any($2::uuid[])) order by a.id limit 201`;
/** Check bounded IDs/count and payload size inside PostgreSQL before exporting
 * any history JSON. Each event contains a full state, not just a small delta. */
function boundedHistoryQuery(table: "event_ledger_entries" | "daily_portfolio_snapshots", column: string, limit: number, projection: string, order: string) {
  return `with candidate as materialized (
    select e.id from ${table} e where e.canonical_owner_user_id=$1::uuid and e.${column} is not null
      and ($2::uuid is null or e.account_id=$2::uuid) order by ${order} limit ${limit + 1}
  ), counted as materialized (select count(*)<=${limit} as complete from candidate), sized as materialized (
    select coalesce(sum(octet_length(e.${column}::text)),0)<=16777216 as complete
      from ${table} e join candidate c on c.id=e.id where (select complete from counted)
  ), coverage as (select counted.complete and sized.complete as complete from counted,sized)
  select coverage.complete,case when coverage.complete then coalesce((
    select jsonb_agg(row_to_json(selected)) from (
      select ${projection} from ${table} e join candidate c on c.id=e.id order by ${order}
    ) selected),'[]'::jsonb) else '[]'::jsonb end as rows from coverage`;
}
const NATIVE_ENTRIES_QUERY = boundedHistoryQuery("event_ledger_entries", "native_data", 10000,
  'e.id,e.account_id as "accountId",e.native_operation_id as "operationId",e.native_data as data', "e.recorded_at,e.native_sequence,e.account_id,e.id");
const NATIVE_SNAPSHOTS_QUERY = boundedHistoryQuery("daily_portfolio_snapshots", "native_evidence", 1000,
  'e.account_id as "accountId",e.native_evidence as evidence', "e.captured_at desc,e.id");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const hasNativeLedger = cache(async (tenant: TenantContext, scope?: PortfolioAnalysisScope) => {
  const group = scope?.kind === "portfolio_group";
  const [, rows] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query(`select exists(select 1 from accounts a where a.canonical_owner_user_id=$1::uuid and a.native_state is not null and ($2::uuid is null or a.id=$2::uuid)
      ${group ? `and (exists(select 1 from portfolio_group_account_memberships m where m.account_id=a.id and m.canonical_owner_user_id=$1::uuid and m.portfolio_group_id=$3::uuid and m.valid_from <= $4::date and (m.valid_to is null or m.valid_to > $4::date))
        or exists(select 1 from assets h join portfolio_group_asset_memberships m on m.asset_id=h.id and m.canonical_owner_user_id=$1::uuid where h.account_id=a.id and h.canonical_owner_user_id=$1::uuid and m.portfolio_group_id=$3::uuid and m.valid_from <= $4::date and (m.valid_to is null or m.valid_to > $4::date)))` : ""}) as present`, [tenant.ownerUserId, scope?.kind === "account" ? scope.accountId : null, ...(group ? [scope.portfolioGroupId, resolveSnapshotCycle(new Date()).snapshotDate] : [])]),
  ], { readOnly: true });
  return rows[0]?.present === true;
});

/** The SQL connection remains the tenant role; owner predicates AND RLS apply. */
export async function readNativeLedger(tenant: TenantContext, accountId?: string) {
  if (!UUID.test(tenant.ownerUserId) || (accountId && !UUID.test(accountId))) throw new Error("native_invalid_scope");
  const sql = getTenantSqlClient();
  const result = await sql.transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query(NATIVE_ACCOUNTS_QUERY, [tenant.ownerUserId, accountId ? [accountId] : null]),
    tx.query(NATIVE_ENTRIES_QUERY, [tenant.ownerUserId, accountId ?? null]),
    tx.query(NATIVE_SNAPSHOTS_QUERY, [tenant.ownerUserId, accountId ?? null]),
  ], { isolationLevel: "RepeatableRead", readOnly: true });
  const accountsComplete = result[1].length <= 200;
  const entriesComplete = result[2][0]?.complete === true;
  const historyComplete = accountsComplete && entriesComplete && result[3][0]?.complete === true;
  // Current balances and original cost lots live in account state. A bounded
  // historical read must not make that state, or future transactions, unusable.
  // Do not present a truncated ledger as complete cash-flow/performance evidence.
  return { accounts: result[1].slice(0, 200) as NativeStoredAccount[], accountsComplete, entriesComplete, historyComplete,
    entries: (entriesComplete ? result[2][0].rows : []) as NativeStoredEntry[], snapshots: (historyComplete ? result[3][0].rows : []) as { accountId: string; evidence: unknown }[] };
}

/** Mutation preflight reads at most the affected two accounts, an exact retry,
 * and each account's latest capture. The SQL writer rechecks under its owner lock. */
async function readNativeMutationContext(tenant: TenantContext, input: NativeMutation) {
  if (!UUID.test(tenant.ownerUserId)) throw new Error("native_invalid_scope");
  const ids = input.event?.type === "transfer" ? [input.accountId, input.event.peerAccountId] : [input.accountId];
  const result = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query(NATIVE_ACCOUNTS_QUERY, [tenant.ownerUserId, ids]),
    tx.query(`select native_data->'request' as request from event_ledger_entries
      where canonical_owner_user_id=$1::uuid and native_operation_id=$2::uuid and native_data is not null limit 1`, [tenant.ownerUserId, input.operationId]),
    tx.query(`select account_id as "accountId",max((native_evidence->'frame'->>'at')::timestamptz)::text as at
      from daily_portfolio_snapshots where canonical_owner_user_id=$1::uuid and account_id=any($2::uuid[]) and native_evidence is not null group by account_id`, [tenant.ownerUserId, ids]),
  ], { isolationLevel: "RepeatableRead", readOnly: true });
  return { accounts: result[1] as NativeStoredAccount[], duplicate: result[2][0], captures: result[3] as { accountId: string; at: string }[] };
}

type NativeUserEvent = NativeEvent extends infer E ? E extends NativeEvent ? Omit<E, "id" | "sequence" | "source"> : never : never;
export type NativeMutation = {
  operationId: string; accountId: string; expectedSequence: number | null;
  opening?: Omit<NativeOpeningInput, "accountId">;
  event?: NativeUserEvent;
  newAsset?: { id: string; name: string; ticker: string; market: "us" | "korea"; currency: "USD" | "KRW"; assetType: "stock" | "etf" };
};

function strictKeys(value: object, keys: string[]) { return Object.keys(value).every(key => keys.includes(key)); }
/** No owner, source, fixture or provider evidence is accepted from the browser. */
export function validNativeMutation(value: unknown): value is NativeMutation {
  try { return validNativeMutationChecked(value); } catch { return false; }
}
function validNativeMutationChecked(value: unknown): value is NativeMutation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as NativeMutation;
  if (!strictKeys(v, ["operationId", "accountId", "expectedSequence", "opening", "event", "newAsset"]) || !UUID.test(v.operationId ?? "") || !UUID.test(v.accountId ?? "") || (v.expectedSequence !== null && (!Number.isSafeInteger(v.expectedSequence) || v.expectedSequence < 0)) || Boolean(v.opening) === Boolean(v.event)) return false;
  if (v.opening && (!strictKeys(v.opening, ["at", "cash", "positions"]) || v.expectedSequence !== null || v.newAsset)) return false;
  if (v.event) {
    const fields: Record<string, string[]> = { deposit: ["amount", "currency"], withdraw: ["amount", "currency"], dividend: ["amount", "currency", "assetId"], fee: ["amount", "currency", "assetId"], buy: ["assetId", "quantity", "price", "currency", "fee"], sell: ["assetId", "quantity", "price", "currency", "fee"], exchange: ["debit", "credit", "fee"], transfer: ["direction", "amount", "currency", "transferId", "peerAccountId"], split: ["assetId", "ratio"], cost_basis: ["assetId", "costLots"] };
    if (!fields[v.event.type] || !strictKeys(v.event, ["type", "at", ...fields[v.event.type]]) || v.expectedSequence === null) return false;
  }
  if (v.newAsset) {
    const a = v.newAsset;
    if (!strictKeys(a, ["id", "name", "ticker", "market", "currency", "assetType"]) || v.event?.type !== "buy" || !UUID.test(a.id) || !a.name.trim() || a.name.length > 100 || !/^[A-Z0-9.\-]{1,20}$/.test(a.ticker) || !["us", "korea"].includes(a.market) || !["stock", "etf"].includes(a.assetType) || !isCurrency(a.currency)) return false;
    if ((v.event as NativeEvent & { assetId: string; currency: string }).assetId !== a.id || (v.event as NativeEvent & { currency: string }).currency !== a.currency || (a.market === "us") !== (a.currency === "USD")) return false;
  }
  const lots = v.opening?.positions.flatMap(p => p.costLots ?? []) ?? (v.event?.type === "cost_basis" ? v.event.costLots : []);
  if (!Array.isArray(lots) || lots.some(lot => lot.source !== "user_native_ledger")) return false;
  return true;
}

export async function writeNativeMutation(tenant: TenantContext, input: NativeMutation) {
  if (!validNativeMutation(input)) return { status: "invalid" as const, reason: "invalid_input" };
  if (input.event?.type === "transfer" && !UUID.test(input.event.peerAccountId ?? "")) return { status: "invalid" as const, reason: "transfer_peer_missing" };
  const ledger = await readNativeMutationContext(tenant, input);
  const duplicate = ledger.duplicate;
  if (duplicate) return { status: canonical(duplicate.request) === canonical(input) ? "existing" as const : "conflict" as const };
  const account = ledger.accounts.find(row => row.id === input.accountId);
  if (account?.active === false) return { status: "inactive" as const };
  if (!account || (account.state?.sequence ?? null) !== input.expectedSequence) return { status: "conflict" as const };
  const changes: NonNullable<ReturnType<typeof change>>[] = [];
  const at = input.opening?.at ?? input.event?.at ?? "";
  if (!Number.isFinite(Date.parse(at)) || Date.parse(at) > Date.now()) return { status: "invalid" as const, reason: "invalid_time" };
  if (input.event && ledger.captures.some(s => Date.parse(s.at) >= Date.parse(at))) return { status: "invalid" as const, reason: "event_precedes_recorded_snapshot" };
  function change(a: NativeStoredAccount, event: NativeEvent | null) {
    if (a.state && a.assets.some(asset => !asset.archived && !a.state!.positions.some(p => p.assetId === asset.id && p.currency === asset.currency && Decimal.from(p.quantity).compare(asset.quantity) === 0))) return null;
    if (a.state && a.state.positions.some(p => !a.assets.some(asset => asset.id === p.assetId && asset.currency === p.currency && Decimal.from(asset.quantity).compare(p.quantity) === 0 && asset.archived === (Decimal.from(p.quantity).compare(0) === 0)))) return null;
    const result = event && a.state ? applyNativeEvent(a.state, event) : createNativePortfolioState({ ...input.opening!, accountId: a.id });
    if (!result.ok) return null;
    const next = "next" in result ? result.next : result.state;
    if (!a.state && (a.assets.filter(x => !x.archived).some(asset => !next.positions.some(p => p.assetId === asset.id && p.currency === asset.currency && Decimal.from(p.quantity).compare(asset.quantity) === 0)) || next.positions.some(p => !a.assets.some(asset => !asset.archived && asset.id === p.assetId && asset.currency === p.currency && Decimal.from(asset.quantity).compare(p.quantity) === 0)))) return null;
    return { accountId: a.id, expectedState: a.state, expectedAssets: a.assets, next, event: event ?? { type: "opening", at }, effect: "next" in result ? { cashLegs: result.cashLegs, quantityDelta: result.quantityDelta, realized: result.realized } : null, entryId: randomUUID(), serviceDate: resolveSnapshotCycle(new Date(at)).snapshotDate, newAsset: a.id === input.accountId ? input.newAsset ?? null : null };
  }
  const event = input.event ? { ...input.event, id: input.operationId, sequence: (account.state?.sequence ?? 0) + 1, source: "user_native_ledger" } as NativeEvent : null;
  // New zero-quantity instrument is introduced only as part of its actual first buy.
  const primary = change(account, event);
  if (!primary) return { status: "invalid" as const, reason: "state_or_event_mismatch" };
  changes.push(primary);
  if (event?.type === "transfer") {
    const peer = ledger.accounts.find(a => a.id === event.peerAccountId);
    if (!peer?.state || peer.active === false || peer.id === account.id || event.transferId !== input.operationId) return { status: "invalid" as const, reason: "transfer_peer_missing" };
    const other = change(peer, { ...event, direction: event.direction === "out" ? "in" : "out", peerAccountId: account.id, sequence: peer.state.sequence + 1 });
    if (!other) return { status: "invalid" as const, reason: "transfer_peer_mismatch" };
    changes.push(other);
  }
  const resultRows = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true),set_config('lock_timeout','2000',true),set_config('statement_timeout','8000',true)", [tenant.ownerUserId]),
    tx.query("select 1/(case when rolsuper or rolbypassrls then 0 else 1 end) as safe from pg_roles where rolname=current_user"),
    tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`varda.portfolio_mutation.v1:${tenant.ownerUserId}`]),
    tx.query("select apply_native_portfolio_tenant_mutation($1::uuid,$2::uuid,$3::jsonb,$4::jsonb) as status", [tenant.ownerUserId, input.operationId, JSON.stringify(input), JSON.stringify(changes)]),
  ], { isolationLevel: "ReadCommitted" });
  const rows = resultRows[3];
  const status = rows[0]?.status;
  if (status === "event_precedes_recorded_snapshot") return { status: "invalid" as const, reason: status };
  if (!["created", "existing", "conflict", "inactive"].includes(String(status))) throw new Error("native_write_unavailable");
  return { status: status as "created" | "existing" | "conflict" | "inactive" };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
