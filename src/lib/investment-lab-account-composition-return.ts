import { compensatedSum } from "./investment-lab-account-composition-contract.ts";
import type { InvestmentLabModifiedDietzPeriod } from "./investment-lab-modified-dietz.ts";
import {
  calculateInvestmentLabPathRisk,
  unavailableInvestmentLabPathRisk,
  type InvestmentLabPathRiskMetrics,
} from "./investment-lab-path-risk.ts";
import {
  isRiskDate,
  riskCalendarDayDistance,
} from "./portfolio-risk-calendar.ts";

export const INVESTMENT_LAB_ACCOUNT_RETURN_COMPOSITION_POLICY = Object.freeze({
  version: "named_account_modified_dietz_period_sum_v1",
  axis: "exact_named_account_period_axis",
  numerator: "sum_of_named_account_period_numerators",
  denominator: "sum_of_named_account_period_denominators",
  linking: "geometric",
  pooledReturnReuse: "forbidden",
} as const);

export type InvestmentLabAccountReturnCompositionBlocker =
  | "named_period_evidence_unavailable"
  | "period_axis_mismatch"
  | "invalid_period_evidence"
  | "non_positive_composed_denominator"
  | "invalid_composed_period_return";

export type InvestmentLabAccountReturnComposition =
  | Readonly<{
      status: "ready";
      policy: typeof INVESTMENT_LAB_ACCOUNT_RETURN_COMPOSITION_POLICY;
      totalReturn: number;
      periodCount: number;
      flowCount: number;
      periods: readonly InvestmentLabModifiedDietzPeriod[];
      riskMetrics: InvestmentLabPathRiskMetrics;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      policy: typeof INVESTMENT_LAB_ACCOUNT_RETURN_COMPOSITION_POLICY;
      totalReturn: null;
      periodCount: 0;
      flowCount: 0;
      periods: readonly [];
      riskMetrics: InvestmentLabPathRiskMetrics;
      blockers: readonly InvestmentLabAccountReturnCompositionBlocker[];
    }>;

export function composeInvestmentLabNamedAccountReturns(
  namedPeriods: readonly (readonly InvestmentLabModifiedDietzPeriod[])[],
): InvestmentLabAccountReturnComposition {
  if (
    !Array.isArray(namedPeriods) ||
    namedPeriods.length === 0 ||
    namedPeriods.some((periods) => !Array.isArray(periods) || periods.length === 0)
  ) {
    return unavailable(["named_period_evidence_unavailable"]);
  }

  const axis = namedPeriods[0];
  if (
    namedPeriods.some(
      (periods) =>
        periods.length !== axis.length ||
        periods.some(
          (period: InvestmentLabModifiedDietzPeriod, index: number) =>
            !sameAxis(period, axis[index]),
        ),
    )
  ) {
    return unavailable(["period_axis_mismatch"]);
  }
  if (namedPeriods.some((periods) => !validPeriodSeries(periods))) {
    return unavailable(["invalid_period_evidence"]);
  }

  const periods: InvestmentLabModifiedDietzPeriod[] = [];
  let linkedGrowth = 1;
  let flowCount = 0;

  for (let index = 0; index < axis.length; index += 1) {
    const accountPeriods = namedPeriods.map((rows) => rows[index]);
    const beginningValueKrw = compensatedSum(
      accountPeriods.map((period) => period.beginningValueKrw),
    );
    const endingValueKrw = compensatedSum(
      accountPeriods.map((period) => period.endingValueKrw),
    );
    const netExternalFlowKrw = compensatedSum(
      accountPeriods.map((period) => period.netExternalFlowKrw),
    );
    const weightedExternalFlowKrw = compensatedSum(
      accountPeriods.map((period) => period.weightedExternalFlowKrw),
    );
    const denominatorKrw = compensatedSum(
      accountPeriods.map((period) => period.denominatorKrw),
    );
    const periodFlowCount = accountPeriods.reduce(
      (total, period) => total + period.flowCount,
      0,
    );
    if (
      !Number.isFinite(denominatorKrw) ||
      denominatorKrw <= 0 ||
      !sameNumber(denominatorKrw, beginningValueKrw + weightedExternalFlowKrw)
    ) {
      return unavailable(["non_positive_composed_denominator"]);
    }

    const periodReturn =
      (endingValueKrw - beginningValueKrw - netExternalFlowKrw) /
      denominatorKrw;
    const growthFactor = 1 + periodReturn;
    if (
      !Number.isFinite(periodReturn) ||
      !Number.isFinite(growthFactor) ||
      growthFactor < -1e-12
    ) {
      return unavailable(["invalid_composed_period_return"]);
    }

    linkedGrowth *= Math.max(0, growthFactor);
    if (!Number.isFinite(linkedGrowth)) {
      return unavailable(["invalid_composed_period_return"]);
    }
    flowCount += periodFlowCount;
    periods.push(
      Object.freeze({
        startServiceDate: axis[index].startServiceDate,
        endServiceDate: axis[index].endServiceDate,
        calendarDays: axis[index].calendarDays,
        beginningValueKrw: cleanZero(beginningValueKrw),
        endingValueKrw: cleanZero(endingValueKrw),
        netExternalFlowKrw: cleanZero(netExternalFlowKrw),
        weightedExternalFlowKrw: cleanZero(weightedExternalFlowKrw),
        denominatorKrw: cleanZero(denominatorKrw),
        flowCount: periodFlowCount,
        periodReturn: cleanZero(periodReturn),
      }),
    );
  }

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_ACCOUNT_RETURN_COMPOSITION_POLICY,
    totalReturn: cleanZero(linkedGrowth - 1),
    periodCount: periods.length,
    flowCount,
    periods: Object.freeze(periods),
    riskMetrics: calculateInvestmentLabPathRisk(periods),
    blockers: [] as const,
  });
}

export function investmentLabReturnPeriodAxesMatch(
  left: readonly InvestmentLabModifiedDietzPeriod[],
  right: readonly InvestmentLabModifiedDietzPeriod[],
) {
  return (
    left.length === right.length &&
    left.every((period, index) => sameAxis(period, right[index]))
  );
}

function validPeriodSeries(
  periods: readonly InvestmentLabModifiedDietzPeriod[],
) {
  return periods.every((period, index) => {
    const expectedDenominator =
      period.beginningValueKrw + period.weightedExternalFlowKrw;
    const expectedReturn =
      (period.endingValueKrw -
        period.beginningValueKrw -
        period.netExternalFlowKrw) /
      period.denominatorKrw;
    return (
      isRiskDate(period.startServiceDate) &&
      isRiskDate(period.endServiceDate) &&
      period.startServiceDate < period.endServiceDate &&
      period.calendarDays ===
        riskCalendarDayDistance(
          period.startServiceDate,
          period.endServiceDate,
        ) &&
      Number.isFinite(period.beginningValueKrw) &&
      period.beginningValueKrw >= 0 &&
      Number.isFinite(period.endingValueKrw) &&
      period.endingValueKrw >= 0 &&
      Number.isFinite(period.netExternalFlowKrw) &&
      Number.isFinite(period.weightedExternalFlowKrw) &&
      Number.isFinite(period.denominatorKrw) &&
      period.denominatorKrw > 0 &&
      Number.isInteger(period.flowCount) &&
      period.flowCount >= 0 &&
      Number.isFinite(period.periodReturn) &&
      1 + period.periodReturn >= -1e-12 &&
      sameNumber(period.denominatorKrw, expectedDenominator) &&
      sameNumber(period.periodReturn, expectedReturn) &&
      (index === 0 ||
        periods[index - 1].endServiceDate === period.startServiceDate)
    );
  });
}

function sameAxis(
  left: InvestmentLabModifiedDietzPeriod,
  right: InvestmentLabModifiedDietzPeriod,
) {
  return (
    left.startServiceDate === right.startServiceDate &&
    left.endServiceDate === right.endServiceDate &&
    left.calendarDays === right.calendarDays
  );
}

function sameNumber(left: number, right: number, tolerance = 1e-9) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      tolerance * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function unavailable(
  blockers: readonly InvestmentLabAccountReturnCompositionBlocker[],
): InvestmentLabAccountReturnComposition {
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_ACCOUNT_RETURN_COMPOSITION_POLICY,
    totalReturn: null,
    periodCount: 0 as const,
    flowCount: 0 as const,
    periods: [] as const,
    riskMetrics: unavailableInvestmentLabPathRisk(),
    blockers: Object.freeze([...new Set(blockers)]),
  });
}

function cleanZero(value: number) {
  return Math.abs(value) <= 1e-12 ? 0 : value;
}
