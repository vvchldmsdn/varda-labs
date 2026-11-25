import "server-only";
import type { PortfolioAnalysisScope } from "../portfolio-analysis-scope";
import type { TenantContext } from "../session-resolver-contract";
import { isEmptyInvestment, type CurrentMarks } from "./period-performance-live";
import type { PerformanceObservation } from "./period-performance";
import { resolveSnapshotCycle } from "../snapshots/market-calendar";
import { isDashboardInvestmentAsset, markDashboardInvestmentAssets } from "../portfolio-dashboard-demand";
import type { TrackedNativePosition } from "../currency-tracked-portfolio";
import { Decimal, isCurrency } from "../money";
import { toNumber } from "../portfolio-math";
import { MANUAL_ASSET_PRICE_POLICY } from "../market-data/manual-asset-price";
import { CURRENT_VALUATION_FX_MAX_AGE_MS, selectCurrentValuationFx } from "../market-data/current-valuation-fx";
import type { getReadOnlyTenantPortfolioDashboardSources } from "@/db/queries/portfolio-dashboard";

export async function readPerformanceMarks(tenant: TenantContext, scope: PortfolioAnalysisScope, at: Date, holdings: boolean,
  latest: ReadonlyMap<string,{ at: string; observation: PerformanceObservation }>): Promise<CurrentMarks> {
  if (holdings) return readHomeMarks(tenant, scope, at, latest);
  const { getTrackedCurrencyEvidence } = await import("@/db/queries/currency-tracked-portfolio");
  return getTrackedCurrencyEvidence(tenant, scope, "KRW", { asOf: at, collect: false, currentOnly: true });
}

/** Legacy KRW investment history uses the same holdings and price selection as
 * the legacy KRW home. A setting-only FX rate or an undocumented change in a
 * manual value cannot establish earned performance. */
async function readHomeMarks(tenant: TenantContext, scope: PortfolioAnalysisScope, now: Date,
  latest: ReadonlyMap<string,{ at: string; observation: PerformanceObservation }>): Promise<CurrentMarks> {
  const { getReadOnlyTenantPortfolioDashboardSources } = await import("@/db/queries/portfolio-dashboard");
  const sources = await getReadOnlyTenantPortfolioDashboardSources({ tenantContext: tenant, scope,
    serviceDate: resolveSnapshotCycle(now).snapshotDate, sourceMode: "valuation", now });
  return homePerformanceMarks(sources, tenant, now, latest);
}

export function homePerformanceMarks(sources: Awaited<ReturnType<typeof getReadOnlyTenantPortfolioDashboardSources>>,
  tenant: TenantContext, now: Date, latest: ReadonlyMap<string, {at: string; observation: PerformanceObservation}>): CurrentMarks {
  const asOf = now.toISOString(), fixedKrwByAsset = new Map<string, number>();
  const activeHoldings = sources.assetRows.filter(asset => isDashboardInvestmentAsset(asset) &&
    !isEmptyInvestment(asset.quantity, asset.fractionalKrwValue));
  const selected = markDashboardInvestmentAssets(activeHoldings, sources.liveQuoteRows);
  const positions = selected.map((asset): TrackedNativePosition => {
    const base = { id: asset.id, accountId: asset.accountId, ownerId: asset.canonicalOwnerUserId ?? "",
      name: asset.name, ticker: asset.ticker, market: asset.market, kind: "holding" as const, observation: null };
    if (!isCurrency(asset.currency) || asset.updatedAt > now || !asset.currentPrice || !asset.quantity) return base;
    const fixed = toNumber(asset.fractionalKrwValue) ?? 0;
    fixedKrwByAsset.set(asset.id, fixed);
    const raw = { at: asOf, basis: "raw" as const, currency: asset.currency, price: asset.currentPrice, quantity: asset.quantity };
    if (!asset.ticker && asset.currency === "KRW") {
      if (asset.priceSource === MANUAL_ASSET_PRICE_POLICY.source && asset.priceQuoteType === MANUAL_ASSET_PRICE_POLICY.quoteType &&
          asset.priceStatus === MANUAL_ASSET_PRICE_POLICY.status && asset.priceAsOf && asset.priceAsOf <= now) {
        return { ...base, observation: { ...raw, source: "manual_entry", timestampBasis: "stored_valuation",
          manualRecordedAt: asset.priceAsOf.toISOString() } };
      }
      const saved = latest.get(asset.accountId);
      const row = saved?.observation.positions.find(row => row.assetId === asset.id);
      // A dated, unchanged stored mark can be carried at its recorded value.
      if (!asset.priceAsOf && saved && row?.currency === "KRW" && row.quantity !== null && row.marketValueKrw !== null &&
          asset.updatedAt.getTime() <= Date.parse(saved.at) && Date.parse(saved.at) <= now.getTime() &&
          Decimal.from(asset.quantity).compare(row.quantity) === 0 && (row.fixedKrw ?? 0) === fixed &&
          Decimal.from(asset.quantity).mul(asset.currentPrice).add(fixed).compare(row.marketValueKrw) === 0) {
        return { ...base, observation: { ...raw, source: "stored_manual_snapshot", timestampBasis: "stored_valuation", manualRecordedAt: saved.at } };
      }
      return base;
    }
    if (asset.priceStatus !== "ok" || !asset.priceSource || !asset.priceAsOf || !asset.priceFetchedAt ||
        asset.priceAsOf > asset.priceFetchedAt || asset.priceFetchedAt > now) return base;
    return { ...base, observation: { ...raw, source: asset.priceSource,
      priceObservedAt: asset.priceAsOf.toISOString(), priceFetchedAt: asset.priceFetchedAt.toISOString() } };
  });
  const rate = selectCurrentValuationFx(sources.recentFxRows, now);
  const nativeSequences = Object.fromEntries(sources.accountRows.flatMap(row => {
    const sequence = (row.nativeState as {sequence?: number}|null)?.sequence;
    return sequence === undefined ? [] : [[row.id, sequence]];
  }));
  return { ownerId: tenant.ownerUserId, reporting: "KRW", asOf, fixedKrwByAsset, nativeSequences,
    activeAccountIds: sources.accountRows.map(row => row.id),
    current: { at: asOf, source: "dashboard_investments", scopeComplete: true, positions },
    history: [], trades: null, maxFxAgeMs: CURRENT_VALUATION_FX_MAX_AGE_MS, maxPriceAgeMs: 10*86400000,
    fx: rate ? [rate] : [],
  };
}
