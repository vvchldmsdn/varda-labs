import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { fxRates } from "@/db/schema";
import { getTenantSqlClient } from "@/db/tenant-client";
import type { TenantContext } from "@/lib/session-resolver-contract";
import { LAB_TRADE_FX_AGE_MS, projectLabNativeEvents, type LabEffectiveEvent } from "@/lib/investment-lab-native-events";

// The effective view applies the latest revision plus later events. Select the
// economic event only. Request payloads and full account states stay private.
const EFFECTIVE_EVENTS_SQL = `select a.id as "accountId", a.code as account, e.native_sequence as sequence,
  case when ev.value->>'type' in ('buy','sell') then ev.value - 'memo' - 'source'
       else jsonb_build_object('type',ev.value->>'type','at',ev.value->>'at') end as event,
  h.id as "linkedAssetId", h.legacy_base44_id as "legacyAssetId", h.name as "assetName",
  h.market, h.asset_type as "assetType"
  from effective_native_ledger_entries e
  join accounts a on a.id=e.account_id and a.canonical_owner_user_id=e.canonical_owner_user_id
  cross join lateral (select e.native_data->'event' as value) ev
  left join assets h on h.id::text=ev.value->>'assetId' and h.account_id=e.account_id
    and h.canonical_owner_user_id=e.canonical_owner_user_id
  where e.canonical_owner_user_id=$1::uuid and a.is_active and a.id=$2::uuid
  order by e.account_id,e.native_sequence,e.id limit 10001`;

export async function loadLabNativeEvents(tenant: TenantContext, accountId: string) {
  const [, records] = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
    tx.query(EFFECTIVE_EVENTS_SQL, [tenant.ownerUserId, accountId]),
  ], { isolationLevel: "RepeatableRead", readOnly: true });
  if (records.length > 10000) throw new Error("lab_native_history_too_large");
  const rows = records as LabEffectiveEvent[];
  // A raw-to-effective transition without an owned opening is an incomplete
  // ledger, not evidence of zero activity.
  if (rows[0]?.event.type !== "opening" || rows[0].sequence !== 0) throw new Error("lab_native_opening_missing");
  if (rows.some((row, index) => row.accountId !== accountId ||
      (index > 0 && (row.event.type === "opening" || row.sequence <= rows[index - 1].sequence)))) {
    throw new Error("lab_native_ledger_order_invalid");
  }
  const times = rows.flatMap(({event}) => (event.type === "buy" || event.type === "sell") &&
    (event.settlement?.currency ?? event.currency) === "USD" ? [Date.parse(event.at)] : []);
  if (!times.length) return projectLabNativeEvents(rows, []);
  const rates = await db.select({
    rate: fxRates.usdKrw, observedAt: fxRates.observedAt, fetchedAt: fxRates.fetchedAt, source: fxRates.source,
  }).from(fxRates).where(and(eq(fxRates.isSample, false), eq(fxRates.status, "ok"), eq(fxRates.rateKind, "daily_reference"),
    gte(fxRates.observedAt, new Date(Math.min(...times) - LAB_TRADE_FX_AGE_MS)),
    lte(fxRates.observedAt, new Date(Math.max(...times))))).orderBy(asc(fxRates.observedAt)).limit(5001);
  if (rates.length > 5000) throw new Error("lab_native_fx_window_too_large");
  return projectLabNativeEvents(rows, rates.flatMap(row => row.observedAt && row.fetchedAt && row.source
    ? [{ base: "USD", quote: "KRW", kind: "daily_reference", rate: row.rate, source: row.source,
        observedAt: row.observedAt.toISOString(), fetchedAt: row.fetchedAt.toISOString() }] : []));
}
