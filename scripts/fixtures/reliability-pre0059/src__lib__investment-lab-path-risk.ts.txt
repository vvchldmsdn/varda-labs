export const INVESTMENT_LAB_PATH_RISK_POLICY = Object.freeze({
  version: "cashflow_adjusted_linked_path_risk_v2",
  returnSource: "modified_dietz_period_returns",
  maximumDrawdown:
    "observed_service_date_linked_growth_peak_to_trough",
  annualizedVolatility:
    "consecutive_daily_sample_standard_deviation_sqrt_365",
  volatilityObservationAxis: "consecutive_calendar_day_service_periods",
  requiredCalendarDaysPerVolatilityPeriod: 1,
  annualizationFactor: 365,
  minimumAnnualizedVolatilityPeriods: 20,
  partialResultHandling: "preserve_available_metric",
} as const);

export type InvestmentLabPathRiskMetrics = Readonly<{
  status: "ready" | "partial" | "unavailable";
  policy: typeof INVESTMENT_LAB_PATH_RISK_POLICY;
  maximumDrawdown: number | null;
  annualizedVolatility: number | null;
  periodCount: number;
  blockers: readonly (
    | "insufficient_periods"
    | "insufficient_volatility_periods"
    | "irregular_volatility_axis"
    | "invalid_period_return"
    | "non_finite_linked_growth"
    | "non_finite_volatility"
  )[];
}>;

type PeriodReturn = Readonly<{
  periodReturn: number;
  calendarDays: number;
}>;

export function calculateInvestmentLabPathRisk(
  periods: readonly PeriodReturn[],
): InvestmentLabPathRiskMetrics {
  if (!Array.isArray(periods) || periods.length === 0) {
    return unavailable(["insufficient_periods"]);
  }

  const returns: number[] = [];
  let hasIrregularVolatilityPeriod = false;
  let linkedGrowth = 1;
  let peakGrowth = 1;
  let maximumDrawdown = 0;

  for (const period of periods) {
    const periodReturn = period?.periodReturn;
    const growthFactor = 1 + periodReturn;
    if (
      !Number.isFinite(periodReturn) ||
      !Number.isFinite(growthFactor) ||
      growthFactor < -1e-12
    ) {
      return unavailable(["invalid_period_return"]);
    }

    returns.push(cleanZero(periodReturn));
    if (
      period.calendarDays !==
      INVESTMENT_LAB_PATH_RISK_POLICY.requiredCalendarDaysPerVolatilityPeriod
    ) {
      hasIrregularVolatilityPeriod = true;
    }
    linkedGrowth *= Math.max(0, growthFactor);
    if (!Number.isFinite(linkedGrowth)) {
      return unavailable(["non_finite_linked_growth"]);
    }
    peakGrowth = Math.max(peakGrowth, linkedGrowth);
    maximumDrawdown = Math.max(
      maximumDrawdown,
      1 - linkedGrowth / peakGrowth,
    );
  }

  const volatilityBlockers: Array<
    InvestmentLabPathRiskMetrics["blockers"][number]
  > = [];
  if (
    returns.length <
    INVESTMENT_LAB_PATH_RISK_POLICY.minimumAnnualizedVolatilityPeriods
  ) {
    volatilityBlockers.push("insufficient_volatility_periods");
  }
  if (hasIrregularVolatilityPeriod) {
    volatilityBlockers.push("irregular_volatility_axis");
  }
  if (volatilityBlockers.length > 0) {
    return partial(maximumDrawdown, returns.length, volatilityBlockers);
  }

  const mean = compensatedSum(returns) / returns.length;
  const squaredDeviations = returns.map((value) => (value - mean) ** 2);
  const sampleVariance = compensatedSum(squaredDeviations) / (returns.length - 1);
  const annualizedVolatility = Math.sqrt(
    Math.max(0, sampleVariance) *
      INVESTMENT_LAB_PATH_RISK_POLICY.annualizationFactor,
  );
  if (!Number.isFinite(annualizedVolatility)) {
    return partial(maximumDrawdown, returns.length, [
      "non_finite_volatility",
    ]);
  }

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_PATH_RISK_POLICY,
    maximumDrawdown: cleanZero(maximumDrawdown),
    annualizedVolatility: cleanZero(annualizedVolatility),
    periodCount: returns.length,
    blockers: [] as const,
  });
}

export function unavailableInvestmentLabPathRisk(): InvestmentLabPathRiskMetrics {
  return unavailable(["insufficient_periods"]);
}

function partial(
  maximumDrawdown: number,
  periodCount: number,
  blockers: InvestmentLabPathRiskMetrics["blockers"],
): InvestmentLabPathRiskMetrics {
  return Object.freeze({
    status: "partial",
    policy: INVESTMENT_LAB_PATH_RISK_POLICY,
    maximumDrawdown: cleanZero(maximumDrawdown),
    annualizedVolatility: null,
    periodCount,
    blockers: Object.freeze([...new Set(blockers)]),
  });
}

function unavailable(
  blockers: InvestmentLabPathRiskMetrics["blockers"],
): InvestmentLabPathRiskMetrics {
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_PATH_RISK_POLICY,
    maximumDrawdown: null,
    annualizedVolatility: null,
    periodCount: 0,
    blockers: Object.freeze([...blockers]),
  });
}

function compensatedSum(values: readonly number[]) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation +=
      Math.abs(total) >= Math.abs(value)
        ? total - next + value
        : value - next + total;
    total = next;
  }
  return total + compensation;
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}
