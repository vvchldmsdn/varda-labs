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
  quantity: number;
  currentPrice: number;
  previousPrice: number;
  currentFxRate: number;
  previousFxRate: number;
  fractionalKrwValue?: number;
  previousMarketValueKrw?: number | null;
};

export type FxAwareSnapshotMovementInput = {
  quantity: number;
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
    return typeof usdKrwRate === "number" && usdKrwRate > 0
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
  quantity,
  currentPrice,
  previousPrice,
  currentFxRate,
  previousFxRate,
  fractionalKrwValue = 0,
  previousMarketValueKrw = null,
}: FxAwarePositionMovementInput) {
  const currentBaseValueKrw = quantity * currentPrice * currentFxRate;
  const currentValueKrw = currentBaseValueKrw + fractionalKrwValue;
  const inferredPreviousValueKrw =
    quantity * previousPrice * previousFxRate + fractionalKrwValue;
  const previousValueKrw = previousMarketValueKrw ?? inferredPreviousValueKrw;
  const priceChangeKrw = quantity * (currentPrice - previousPrice) * previousFxRate;
  const fxChangeKrw = quantity * currentPrice * (currentFxRate - previousFxRate);

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
  currentPrice,
  currentValueKrw,
  previousPrice,
  previousValueKrw,
  currentFxRate,
  previousFxRate,
  tradeFlowKrw = 0,
}: FxAwareSnapshotMovementInput) {
  const priceChangeKrw = quantity * (currentPrice - previousPrice) * previousFxRate;
  const fxChangeKrw = quantity * currentPrice * (currentFxRate - previousFxRate);

  return {
    currentValueKrw,
    previousValueKrw,
    changeKrw: currentValueKrw - previousValueKrw - tradeFlowKrw,
    priceChangeKrw,
    fxChangeKrw,
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

export function toNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
