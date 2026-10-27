export function normalizeTicker(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

export function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

export type KrwFxRateResolution =
  | {
      ok: true;
      currency: "KRW" | "USD";
      rate: number;
      requiresFx: boolean;
    }
  | {
      ok: false;
      currency: string;
      rate: null;
      requiresFx: boolean;
      reason: "missing_usd_krw_rate" | "unsupported_currency";
    };

export type FxAwarePositionMovementInput = {
  marketExposedQuantity: number;
  currentPrice: number;
  previousPrice: number;
  currentFxRate: number;
  previousFxRate: number;
  fixedKrwValue?: number;
  previousMarketValueKrw?: number | null;
};

export type FxAwareSnapshotMovementInput = {
  quantity: number;
  previousQuantity?: number | null;
  trades?: readonly { quantityDelta: number; price: number; fxRate: number }[] | null;
  currentPrice: number;
  currentValueKrw: number;
  previousPrice: number;
  previousValueKrw: number;
  currentFxRate: number;
  previousFxRate: number;
  tradeFlowKrw?: number;
};

export function normalizeCurrencyCode(value: string | null | undefined) {
  return value?.trim().toUpperCase() ?? "";
}

export function resolveKrwFxRate(
  currency: string | null | undefined,
  usdKrwRate: number | null | undefined,
): KrwFxRateResolution {
  const code = normalizeCurrencyCode(currency);

  if (code === "KRW") {
    return { ok: true, currency: "KRW", rate: 1, requiresFx: false };
  }

  if (code === "USD") {
    return typeof usdKrwRate === "number" && Number.isFinite(usdKrwRate) && usdKrwRate > 0
      ? { ok: true, currency: "USD", rate: usdKrwRate, requiresFx: true }
      : {
          ok: false,
          currency: "USD",
          rate: null,
          requiresFx: true,
          reason: "missing_usd_krw_rate",
        };
  }

  return {
    ok: false,
    currency: code || "UNKNOWN",
    rate: null,
    requiresFx: true,
    reason: "unsupported_currency",
  };
}

export function convertToKrw(value: number, currency: string, usdKrwRate: number) {
  const resolved = resolveKrwFxRate(currency, usdKrwRate);
  return resolved.ok ? value * resolved.rate : null;
}

export function calculateFxAwarePositionMovementKrw({
  marketExposedQuantity,
  currentPrice,
  previousPrice,
  currentFxRate,
  previousFxRate,
  fixedKrwValue = 0,
  previousMarketValueKrw = null,
}: FxAwarePositionMovementInput) {
  const currentBaseValueKrw = marketExposedQuantity * currentPrice * currentFxRate;
  const currentValueKrw = currentBaseValueKrw + fixedKrwValue;
  const inferredPreviousValueKrw =
    marketExposedQuantity * previousPrice * previousFxRate + fixedKrwValue;
  const previousValueKrw = previousMarketValueKrw ?? inferredPreviousValueKrw;
  const priceChangeKrw =
    marketExposedQuantity * (currentPrice - previousPrice) * previousFxRate;
  const fxChangeKrw =
    marketExposedQuantity * currentPrice * (currentFxRate - previousFxRate);

  return {
    currentValueKrw,
    previousValueKrw,
    changeKrw: currentValueKrw - previousValueKrw,
    priceChangeKrw,
    fxChangeKrw,
  };
}

export function calculateFxAwareSnapshotMovementKrw({
  quantity,
  previousQuantity,
  trades,
  currentPrice,
  currentValueKrw,
  previousPrice,
  previousValueKrw,
  currentFxRate,
  previousFxRate,
  tradeFlowKrw = 0,
}: FxAwareSnapshotMovementInput) {
  const changeKrw = currentValueKrw - previousValueKrw - tradeFlowKrw;
  const hasTradeEvidence = trades !== null && (tradeFlowKrw === 0 || trades !== undefined);
  const legs = trades ?? [];
  const baselineQuantity = previousQuantity ??
    quantity - sumBy([...legs], (trade) => trade.quantityDelta);
  let priceChangeKrw = baselineQuantity * (currentPrice - previousPrice) * previousFxRate;
  let fxChangeKrw = baselineQuantity * currentPrice * (currentFxRate - previousFxRate);
  for (const trade of legs) {
    priceChangeKrw += trade.quantityDelta * (currentPrice - trade.price) * trade.fxRate;
    fxChangeKrw += trade.quantityDelta * currentPrice * (currentFxRate - trade.fxRate);
  }
  // Stored valuations may include fixed KRW balances. Only publish a complete
  // attribution when the observed values and transaction legs reconcile.
  const toleranceKrw = Math.max(0.01, Math.abs(changeKrw) * 1e-10);
  const quantityTolerance = Math.max(1e-8, Math.abs(quantity) * 1e-10);
  const quantitiesReconcile = Math.abs(baselineQuantity +
    sumBy([...legs], (trade) => trade.quantityDelta) - quantity) <= quantityTolerance;
  const validPrices = previousPrice > 0 && currentPrice > 0 && previousFxRate > 0 && currentFxRate > 0 &&
    legs.every((trade) => Number.isFinite(trade.quantityDelta) && trade.price > 0 && trade.fxRate > 0);
  const reconciled = hasTradeEvidence && quantitiesReconcile && validPrices && baselineQuantity >= 0 &&
    Number.isFinite(priceChangeKrw) && Number.isFinite(fxChangeKrw) &&
    Math.abs(priceChangeKrw + fxChangeKrw - changeKrw) <= toleranceKrw;

  return {
    currentValueKrw,
    previousValueKrw,
    changeKrw,
    priceChangeKrw: reconciled ? priceChangeKrw : null,
    fxChangeKrw: reconciled ? fxChangeKrw : null,
    tradeFlowKrw,
  };
}

export function percentOrNull(
  numerator: number | null,
  denominator: number | null,
) {
  return numerator !== null && denominator !== null && denominator > 0
    ? (numerator / denominator) * 100
    : null;
}

export function diffDays(laterDate: string, earlierDate: string) {
  const later = Date.parse(`${laterDate}T00:00:00Z`);
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`);
  if (!Number.isFinite(later) || !Number.isFinite(earlier)) return 0;
  return Math.round((later - earlier) / 86_400_000);
}

export function sumBy<T>(
  rows: T[],
  selector: (row: T) => number | null | undefined,
) {
  return rows.reduce((sum, row) => sum + (selector(row) ?? 0), 0);
}

/** Financial totals are unknown when any required component is unknown. */
export function sumComplete<T>(rows: readonly T[], selector: (row: T) => number | null) {
  let total = 0;
  for (const row of rows) {
    const value = selector(row);
    if (value === null || !Number.isFinite(value)) return null;
    total += value;
  }
  return Number.isFinite(total) ? total : null;
}

export function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
