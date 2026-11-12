import "server-only";

import { runTenantReadTransaction } from "@/db/tenant-transaction-context";
import { fxFactor, valuePosition, type FxEvidence } from "../currency-valuation";
import type { TrackedNativePosition } from "../currency-tracked-portfolio";
import { isCurrency } from "../money";
import { resolveNativeTrade, type NativeTradeInput } from "../native-portfolio-ledger";
import type { PortfolioAnalysisScope } from "../portfolio-analysis-scope";
import { toNumber } from "../portfolio-math";
import type { TenantContext } from "../session-resolver-contract";
import { SNAPSHOT_FX_REFERENCE_MAX_AGE_MS } from "../snapshots/cutoff-fx";
import {
  buildPeriodAttribution, type AttributionAccountObservation, type AttributionPosition, type AttributionTrade,
  type PeriodAttributionRange,
} from "./period-attribution";
import { ATTRIBUTION_ACCOUNTS_SQL, ATTRIBUTION_ENDS_SQL, ATTRIBUTION_TRADES_SQL } from "./period-attribution-sql";

type Row = Readonly<Record<string, unknown>>;
const text = (value: unknown) => typeof value === "string" ? value : null;

function nativePosition(row: TrackedNativePosition, at: string, fx: readonly FxEvidence[]): AttributionPosition {
  const obs = row.observation;
  const base = { assetId: row.id, name: row.name, ticker: row.ticker ?? null, market: row.market ?? null,
    currency: obs?.currency ?? null, quantity: toNumber(obs?.quantity), fixedKrw: null };
  if (!obs || row.unsupportedReason || row.evidenceReason || obs.at !== at || obs.basis !== "raw" ||
    !obs.source?.trim() || obs.timestampBasis === "stored_valuation" || !isCurrency(obs.currency)) {
    return { ...base, price: null, fxRate: null, marketValueKrw: null };
  }
  // A cutoff stores the exact admitted FX evidence. Never consult today's FX or the current asset row.
  const rate = fxFactor(obs.currency, "KRW", at, fx, SNAPSHOT_FX_REFERENCE_MAX_AGE_MS);
  const valuation = valuePosition(obs, "KRW", fx, SNAPSHOT_FX_REFERENCE_MAX_AGE_MS);
  return { ...base, price: toNumber(obs.price), fxRate: rate.ok ? rate.value.toNumber() : null,
    marketValueKrw: valuation.ok ? valuation.value.toNumber() : null };
}

function observation(row: Row, ownerId: string): AttributionAccountObservation {
  const accountId = String(row.account_id), date = String(row.date);
  const positions = Array.isArray(row.positions) ? row.positions : [];
  if (!row.frame_at) return { accountId, date, expectedPositions: toNumber(row.expected_positions), positions };
  const nativeRows = positions as TrackedNativePosition[];
  const owned = nativeRows.filter(p => p && p.accountId === accountId && p.ownerId === ownerId);
  return { accountId, date, expectedPositions: row.frame_complete === true ? nativeRows.length : null,
    positions: owned.map(p => nativePosition(p, String(row.frame_at), Array.isArray(row.native_fx) ? row.native_fx : [])) };
}

function trade(row: Row): AttributionTrade {
  const base = { date: String(row.date), accountId: String(row.account_id), assetId: text(row.asset_id),
    name: text(row.name), ticker: text(row.ticker), market: text(row.market), currency: text(row.currency) };
  const unknown = { ...base, quantityDelta: null, price: null, fxRate: null, flowKrw: null };
  const sign = row.event_type === "buy" ? 1 : row.event_type === "sell" ? -1 : null;
  if (!sign || row.uncertain) return unknown;
  if (row.native_event) {
    const event = row.native_event as NativeTradeInput;
    const q = toNumber(event.quantity);
    if (q === null || q <= 0) return unknown;
    try {
      const execution = resolveNativeTrade(event);
      const gross = execution.settlement;
      const unit = toNumber(execution.executionUnitPrice?.amount) ??
        (gross?.currency === event.currency ? Number(gross.amount) / q : null);
      const grossKrw = gross?.currency === "KRW" ? toNumber(gross.amount) : null;
      // Native gross settlement and the separately recorded charges are distinct. When executed in USD
      // with documented KRW gross, their ratio gives the actual conversion for this execution.
      const rate = event.currency === "KRW" ? 1 : grossKrw !== null && unit !== null && unit > 0 ? grossKrw / (q * unit) : null;
      return { ...base, quantityDelta: sign * q, price: unit, fxRate: rate, flowKrw: grossKrw === null ? null : sign * grossKrw };
    } catch { return unknown; }
  }
  const q = toNumber(row.quantity_delta);
  if (q === null || Math.sign(q) !== sign) return unknown;
  const gross = row.gross as { amount?: string; currency?: string } | null;
  const nativeGross = gross?.currency === base.currency ? toNumber(gross?.amount) : null;
  const price = toNumber(row.price) ?? (nativeGross === null ? null : nativeGross / Math.abs(q));
  const grossKrw = toNumber(row.amount_krw);
  return { ...base, quantityDelta: q, price, fxRate: toNumber(row.fx_rate),
    flowKrw: grossKrw === null ? null : sign * Math.abs(grossKrw) };
}

export async function readPeriodAttribution({ tenantContext, scope, range }: {
  tenantContext: TenantContext; scope: PortfolioAnalysisScope; range: PeriodAttributionRange;
}) {
  if (scope.kind === "portfolio_group") throw new Error("period_attribution_group_unsupported");
  const account = scope.kind === "account" ? scope.accountId : null;
  const period = [account, range.start, range.end];
  const [accounts, ends, events] = await runTenantReadTransaction(tenantContext.ownerUserId, tx => [
    tx.query(ATTRIBUTION_ACCOUNTS_SQL, [account]),
    tx.query(ATTRIBUTION_ENDS_SQL, period),
    tx.query(ATTRIBUTION_TRADES_SQL, period),
  ]);
  return buildPeriodAttribution(range, {
    accounts: accounts.map(a => ({ id: String(a.id), name: String(a.name) })),
    observations: ends.map(row => observation(row, tenantContext.ownerUserId)), trades: events.map(trade),
  });
}
