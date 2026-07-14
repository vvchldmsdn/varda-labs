import type { PortfolioDirectHoldingsBaseline } from "./portfolio-direct-holdings.ts";

export const PORTFOLIO_FX_SHOCK_POLICY = Object.freeze({
  version: "static_usdkrw_direct_holdings_shock_v1",
  exposureScope: "explicit_usd_direct_holdings",
  denominator: "currently_evaluable_direct_holdings_subset",
  localPriceAssumption: "fixed",
  etfLookThrough: "excluded",
  persistence: "browser_memory_only",
  minShockPct: -50,
  maxShockPct: 50,
  forecastRecommendationOrOrderAuthority: "excluded",
} as const);

export type PortfolioFxShockReason =
  | "ready"
  | "no_evaluable_direct_holdings"
  | "no_observed_usd_direct_exposure"
  | "invalid_current_usd_krw_rate"
  | "invalid_shock_pct"
  | "invalid_calculation";

export type PortfolioFxShockResult = Readonly<{
  policy: typeof PORTFOLIO_FX_SHOCK_POLICY;
  selectedAccount: PortfolioDirectHoldingsBaseline["selectedAccount"];
  coverageStatus: PortfolioDirectHoldingsBaseline["status"];
  status: "ready" | "unavailable" | "blocked";
  reason: PortfolioFxShockReason;
  shockPct: number | null;
  currentUsdKrwRate: number | null;
  estimatedUsdKrwRate: number | null;
  evaluatedSubsetValueKrw: number | null;
  usdDirectExposureValueKrw: number | null;
  usdDirectExposureWeightPct: number | null;
  appliedAssetCount: number;
  evaluatedAssetCount: number;
  excludedEvidenceCount: number;
  estimatedChangeKrw: number | null;
  estimatedChangePctPoints: number | null;
  estimatedPostShockSubsetValueKrw: number | null;
}>;

export function calculatePortfolioFxShock({
  baseline,
  currentUsdKrwRate,
  shockPct,
}: {
  baseline: PortfolioDirectHoldingsBaseline;
  currentUsdKrwRate: number | null;
  shockPct: number;
}): PortfolioFxShockResult {
  const base = {
    policy: PORTFOLIO_FX_SHOCK_POLICY,
    selectedAccount: baseline.selectedAccount,
    coverageStatus: baseline.status,
    appliedAssetCount: 0,
    evaluatedAssetCount: baseline.directHoldingCount,
    excludedEvidenceCount:
      baseline.excludedHoldingCount +
      baseline.unresolvedIdentityCount +
      baseline.invalidValueCount,
  } as const;
  const metrics = baseline.metrics;

  if (!metrics) {
    return unavailable(base, "no_evaluable_direct_holdings", currentUsdKrwRate);
  }

  const usdExposure = metrics.currencyExposures.find(
    (row) => row.currency === "USD",
  );
  if (
    !usdExposure ||
    usdExposure.holdingCount === 0 ||
    !isFinitePositive(usdExposure.currentValueKrw)
  ) {
    return unavailable(
      base,
      "no_observed_usd_direct_exposure",
      currentUsdKrwRate,
      metrics.totalValueKrw,
    );
  }

  const evidence = {
    ...base,
    appliedAssetCount: usdExposure.holdingCount,
    evaluatedSubsetValueKrw: metrics.totalValueKrw,
    usdDirectExposureValueKrw: usdExposure.currentValueKrw,
    usdDirectExposureWeightPct: usdExposure.currentWeightPct,
  } as const;

  if (!isFinitePositive(currentUsdKrwRate)) {
    return blocked(evidence, "invalid_current_usd_krw_rate", null, null);
  }
  if (
    !Number.isFinite(shockPct) ||
    shockPct < PORTFOLIO_FX_SHOCK_POLICY.minShockPct ||
    shockPct > PORTFOLIO_FX_SHOCK_POLICY.maxShockPct
  ) {
    return blocked(
      evidence,
      "invalid_shock_pct",
      currentUsdKrwRate,
      Number.isFinite(shockPct) ? shockPct : null,
    );
  }

  const shockRatio = shockPct / 100;
  const estimatedChangeKrw = usdExposure.currentValueKrw * shockRatio;
  const estimatedChangePctPoints =
    usdExposure.currentWeightPct * shockRatio;
  const estimatedPostShockSubsetValueKrw =
    metrics.totalValueKrw + estimatedChangeKrw;
  const estimatedUsdKrwRate = currentUsdKrwRate * (1 + shockRatio);

  if (
    ![
      estimatedChangeKrw,
      estimatedChangePctPoints,
      estimatedPostShockSubsetValueKrw,
      estimatedUsdKrwRate,
    ].every(Number.isFinite) ||
    estimatedPostShockSubsetValueKrw < 0 ||
    estimatedUsdKrwRate <= 0
  ) {
    return blocked(
      evidence,
      "invalid_calculation",
      currentUsdKrwRate,
      shockPct,
    );
  }

  return Object.freeze({
    ...evidence,
    status: "ready" as const,
    reason: "ready" as const,
    shockPct,
    currentUsdKrwRate,
    estimatedUsdKrwRate,
    estimatedChangeKrw: normalizeZero(estimatedChangeKrw),
    estimatedChangePctPoints: normalizeZero(estimatedChangePctPoints),
    estimatedPostShockSubsetValueKrw,
  });
}

function unavailable(
  base: {
    policy: typeof PORTFOLIO_FX_SHOCK_POLICY;
    selectedAccount: PortfolioDirectHoldingsBaseline["selectedAccount"];
    coverageStatus: PortfolioDirectHoldingsBaseline["status"];
    appliedAssetCount: number;
    evaluatedAssetCount: number;
    excludedEvidenceCount: number;
  },
  reason: Extract<
    PortfolioFxShockReason,
    "no_evaluable_direct_holdings" | "no_observed_usd_direct_exposure"
  >,
  currentUsdKrwRate: number | null,
  evaluatedSubsetValueKrw: number | null = null,
): PortfolioFxShockResult {
  return Object.freeze({
    ...base,
    status: "unavailable" as const,
    reason,
    shockPct: null,
    currentUsdKrwRate: isFinitePositive(currentUsdKrwRate)
      ? currentUsdKrwRate
      : null,
    estimatedUsdKrwRate: null,
    evaluatedSubsetValueKrw,
    usdDirectExposureValueKrw: null,
    usdDirectExposureWeightPct: null,
    estimatedChangeKrw: null,
    estimatedChangePctPoints: null,
    estimatedPostShockSubsetValueKrw: null,
  });
}

function blocked(
  evidence: {
    policy: typeof PORTFOLIO_FX_SHOCK_POLICY;
    selectedAccount: PortfolioDirectHoldingsBaseline["selectedAccount"];
    coverageStatus: PortfolioDirectHoldingsBaseline["status"];
    appliedAssetCount: number;
    evaluatedAssetCount: number;
    excludedEvidenceCount: number;
    evaluatedSubsetValueKrw: number;
    usdDirectExposureValueKrw: number;
    usdDirectExposureWeightPct: number;
  },
  reason: Extract<
    PortfolioFxShockReason,
    "invalid_current_usd_krw_rate" | "invalid_shock_pct" | "invalid_calculation"
  >,
  currentUsdKrwRate: number | null,
  shockPct: number | null,
): PortfolioFxShockResult {
  return Object.freeze({
    ...evidence,
    status: "blocked" as const,
    reason,
    shockPct,
    currentUsdKrwRate,
    estimatedUsdKrwRate: null,
    estimatedChangeKrw: null,
    estimatedChangePctPoints: null,
    estimatedPostShockSubsetValueKrw: null,
  });
}

function isFinitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0;
}

function normalizeZero(value: number) {
  return Object.is(value, -0) ? 0 : value;
}
