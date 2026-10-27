import { isKrxGoldManualInstrumentCandidate } from "./market-data/manual-asset-price.ts";
import { toNumber } from "./portfolio-math.ts";

export function resolveAdditionalContributionPolicyParameters(settings?: Readonly<{
  minExecutionRatioPct: string | null;
  trimDriftThreshold: string | null;
  useTrendFilter: boolean;
}>) {
  return Object.freeze({
    minimumExecutionRatioPct: boundedPercent(settings?.minExecutionRatioPct, 85),
    trimDriftThresholdPct: boundedPercent(settings?.trimDriftThreshold, 12),
    useTrendFilter: settings?.useTrendFilter ?? false,
  });
}

type PositionEvidence = Readonly<{
  currency: string;
  quantity: string;
  fractionalKrwValue: string | null;
}>;

// fractional_avg_cost and fractional_krw_value are KRW totals, not unit prices.
export function additionalContributionCostBasisKrw(
  row: PositionEvidence & Readonly<{ averageCost: string | null; fractionalAvgCost: string | null }>,
  usdKrwRate: number | null,
) {
  const quantity = toNumber(row.quantity);
  const fractionalValue = row.fractionalKrwValue === null ? 0 : toNumber(row.fractionalKrwValue);
  const fractionalCost = row.fractionalAvgCost === null
    ? fractionalValue === 0 ? 0 : null
    : toNumber(row.fractionalAvgCost);
  if (quantity === null || quantity < 0 || fractionalValue === null || fractionalValue < 0 || fractionalCost === null || fractionalCost < 0 || (fractionalValue > 0 && fractionalCost === 0)) return null;
  const wholeCost = quantity === 0 ? 0 : convertedPositionValue(quantity, toNumber(row.averageCost), row.currency, usdKrwRate);
  return wholeCost === null ? null : finiteTotal(wholeCost + fractionalCost);
}

export function additionalContributionFallbackValueKrw(
  row: PositionEvidence & Readonly<{ currentPrice: string }>,
  usdKrwRate: number | null,
) {
  const quantity = toNumber(row.quantity);
  const fractionalValue = row.fractionalKrwValue === null ? 0 : toNumber(row.fractionalKrwValue);
  if (quantity === null || quantity < 0 || fractionalValue === null || fractionalValue < 0) return null;
  const wholeValue = quantity === 0 ? 0 : convertedPositionValue(quantity, toNumber(row.currentPrice), row.currency, usdKrwRate);
  return wholeValue === null ? null : finiteTotal(wholeValue + fractionalValue);
}

export function additionalContributionMaAssetClass(row: Readonly<{
  assetName: string;
  assetType: string | null;
  currency: string | null;
  market: string | null;
  maAssetClass: string | null;
  ticker: string | null;
}>) {
  return isKrxGoldManualInstrumentCandidate({ ...row, name: row.assetName })
    ? "defensive_gold"
    : row.maAssetClass?.trim().toLowerCase() || null;
}

export function matchLegacyAdditionalContributionTargets<T extends Readonly<{
  currency: string | null;
  market: string | null;
  ticker: string | null;
  targetWeightPct: number;
}>>({ modelRows, legacyRows, accountId, accountCode }: {
  modelRows: readonly Readonly<{ accountId: string; accountCode: string; assetId: string; currency: string | null; market: string | null; ticker: string | null }>[];
  legacyRows: readonly T[];
  accountId: string;
  accountCode: string;
}) {
  const blockers = new Set<string>();
  const targetsByInstrument = new Map<string, T>();
  const targetsByAsset = new Map<string, T>();
  for (const row of legacyRows) {
    const key = additionalContributionInstrumentKey(row);
    if (!key) blockers.add("valuation_identity_missing");
    else if (targetsByInstrument.has(key)) blockers.add("valuation_identity_duplicate");
    else targetsByInstrument.set(key, row);
  }
  const matched = new Set<string>();
  const assets = new Set<string>();
  for (const row of modelRows) {
    if (row.accountId !== accountId || row.accountCode.trim().toLowerCase() !== accountCode.trim().toLowerCase()) blockers.add("valuation_account_mismatch");
    if (assets.has(row.assetId)) blockers.add("valuation_identity_duplicate");
    assets.add(row.assetId);
    const key = additionalContributionInstrumentKey(row);
    const target = key ? targetsByInstrument.get(key) : undefined;
    if (!key || !target) blockers.add("valuation_identity_missing");
    else {
      if (matched.has(key)) blockers.add("valuation_identity_duplicate");
      matched.add(key);
      targetsByAsset.set(row.assetId, target);
    }
  }
  if (matched.size !== targetsByInstrument.size || modelRows.length !== legacyRows.length) blockers.add("valuation_identity_missing");
  const weights = legacyRows.map((row) => row.targetWeightPct * 100);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0 || weight > 10_000 || Math.abs(weight - Math.round(weight)) > 1e-7) || weights.reduce((sum, weight) => sum + Math.round(weight), 0) !== 10_000) blockers.add("target_policy_incomplete");
  return Object.freeze({
    status: blockers.size === 0 ? "ready" as const : "blocked" as const,
    targetsByAsset,
    blockers: Object.freeze([...blockers].toSorted()),
  });
}

export function additionalContributionInstrumentKey(row: Readonly<{ market: string | null; currency: string | null; ticker: string | null }>) {
  const market = row.market?.trim().toLowerCase();
  const currency = row.currency?.trim().toUpperCase();
  const ticker = row.ticker?.trim().toUpperCase();
  return market && currency && ticker ? `${market}:${currency}:${ticker}` : null;
}

function boundedPercent(value: string | null | undefined, fallback: number) {
  if (value === null || value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : fallback;
}

function convertedPositionValue(quantity: number, price: number | null, currency: string, usdKrwRate: number | null) {
  const code = currency.trim().toUpperCase();
  const fx = code === "KRW" ? 1 : code === "USD" ? usdKrwRate : null;
  if (price === null || price <= 0 || fx === null || !Number.isFinite(fx) || fx <= 0) return null;
  return finiteTotal(quantity * price * fx);
}

function finiteTotal(value: number) {
  return Number.isFinite(value) && value >= 0 ? value : null;
}
