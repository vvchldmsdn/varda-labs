import type {
  InvestmentLabContributionScenarioEvidence,
  InvestmentLabContributionScenarioPoint,
} from "./investment-lab-contribution-experiment.ts";
import {
  INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY,
  type InvestmentLabFixedMixContributionBlocker,
  type InvestmentLabFixedMixContributionEvidence,
  type InvestmentLabFixedMixContributionPoint,
  type InvestmentLabFixedMixContributionResult,
  type InvestmentLabFixedMixContributionRow,
} from "./investment-lab-fixed-mix-contribution-types.ts";
import type { InvestmentLabFixedMixWeights } from "./investment-lab-fixed-mix-types.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

export { INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY } from "./investment-lab-fixed-mix-contribution-types.ts";
export type {
  InvestmentLabFixedMixContributionBlocker,
  InvestmentLabFixedMixContributionEvidence,
  InvestmentLabFixedMixContributionPoint,
  InvestmentLabFixedMixContributionResult,
  InvestmentLabFixedMixContributionRow,
} from "./investment-lab-fixed-mix-contribution-types.ts";

export function createInvestmentLabFixedMixContributionEvidence(input: {
  scenarios: readonly InvestmentLabContributionScenarioEvidence[];
  weights: InvestmentLabFixedMixWeights;
}): InvestmentLabFixedMixContributionEvidence | null {
  if (!validWeights(input.weights)) return null;

  const kodexCandidates = input.scenarios.filter(
    (scenario) => scenario.scenarioId === "kodex200",
  );
  const vooCandidates = input.scenarios.filter(
    (scenario) => scenario.scenarioId === "voo",
  );
  if (kodexCandidates.length !== 1 || vooCandidates.length !== 1) return null;

  const kodex = kodexCandidates[0];
  const voo = vooCandidates[0];
  if (
    kodex.priceBasis !== "adjusted_close_krw" ||
    voo.priceBasis !== "raw_close_usd_times_stored_snapshot_fx" ||
    !validComponentPoints(kodex.points) ||
    !validComponentPoints(voo.points) ||
    kodex.points.length !== voo.points.length
  ) {
    return null;
  }

  const points: InvestmentLabFixedMixContributionPoint[] = [];
  for (let index = 0; index < kodex.points.length; index += 1) {
    const kodexPoint = kodex.points[index];
    const vooPoint = voo.points[index];
    if (kodexPoint.serviceDate !== vooPoint.serviceDate) return null;

    const baseScenarioValueKrw = weightedValue(
      kodexPoint.baseScenarioValueKrw,
      vooPoint.baseScenarioValueKrw,
      input.weights,
    );
    if (!safeNonnegativeCurrency(baseScenarioValueKrw)) return null;

    points.push(
      Object.freeze({
        serviceDate: kodexPoint.serviceDate,
        kodexPriceDate: kodexPoint.valuationPriceDate,
        vooPriceDate: vooPoint.valuationPriceDate,
        kodexUnitValueKrw: kodexPoint.unitValueKrw,
        vooUnitValueKrw: vooPoint.unitValueKrw,
        baseScenarioValueKrw,
      }),
    );
  }

  return Object.freeze({
    weights: Object.freeze({ ...input.weights }),
    points: Object.freeze(points),
  });
}

export function calculateInvestmentLabFixedMixContribution(input: {
  evidence: InvestmentLabFixedMixContributionEvidence;
  contributionServiceDate: string;
  contributionAmountKrw: number;
}): InvestmentLabFixedMixContributionResult {
  if (!validWeights(input.evidence.weights)) {
    return blocked("invalid_weight_selection");
  }
  if (!isValidEvidence(input.evidence)) {
    return blocked("invalid_component_evidence", input.evidence.weights);
  }
  if (
    !Number.isSafeInteger(input.contributionAmountKrw) ||
    input.contributionAmountKrw <= 0
  ) {
    return blocked("invalid_contribution_amount", input.evidence.weights);
  }

  const selectedIndex = input.evidence.points.findIndex(
    (point) => point.serviceDate === input.contributionServiceDate,
  );
  if (selectedIndex < 0) {
    return blocked("contribution_date_unavailable", input.evidence.weights);
  }

  const selected = input.evidence.points[selectedIndex];
  const kodexAmountKrw =
    input.contributionAmountKrw *
    (input.evidence.weights.kodexWeightBps / 10_000);
  const vooAmountKrw = input.contributionAmountKrw - kodexAmountKrw;
  const kodexUnits = kodexAmountKrw / selected.kodexUnitValueKrw;
  const vooUnits = vooAmountKrw / selected.vooUnitValueKrw;
  if (
    !positiveFinite(kodexAmountKrw) ||
    !positiveFinite(vooAmountKrw) ||
    !positiveFinite(kodexUnits) ||
    !positiveFinite(vooUnits) ||
    !nearlyEqual(kodexAmountKrw + vooAmountKrw, input.contributionAmountKrw)
  ) {
    return blocked("invalid_calculation_result", input.evidence.weights);
  }

  const rows: InvestmentLabFixedMixContributionRow[] = [];
  for (
    let index = selectedIndex;
    index < input.evidence.points.length;
    index += 1
  ) {
    const point = input.evidence.points[index];
    const kodexAdditionalValueKrw =
      index === selectedIndex
        ? kodexAmountKrw
        : kodexUnits * point.kodexUnitValueKrw;
    const vooAdditionalValueKrw =
      index === selectedIndex
        ? vooAmountKrw
        : vooUnits * point.vooUnitValueKrw;
    const additionalValueKrw =
      index === selectedIndex
        ? input.contributionAmountKrw
        : kodexAdditionalValueKrw + vooAdditionalValueKrw;
    const projectedScenarioValueKrw =
      point.baseScenarioValueKrw + additionalValueKrw;

    if (
      !safeNonnegativeCurrency(kodexAdditionalValueKrw) ||
      !safeNonnegativeCurrency(vooAdditionalValueKrw) ||
      !safeNonnegativeCurrency(additionalValueKrw) ||
      !safeNonnegativeCurrency(projectedScenarioValueKrw) ||
      !nearlyEqual(
        kodexAdditionalValueKrw + vooAdditionalValueKrw,
        additionalValueKrw,
      )
    ) {
      return blocked("invalid_calculation_result", input.evidence.weights);
    }

    rows.push(
      Object.freeze({
        serviceDate: point.serviceDate,
        kodexPriceDate: point.kodexPriceDate,
        vooPriceDate: point.vooPriceDate,
        baseScenarioValueKrw: point.baseScenarioValueKrw,
        kodexAdditionalValueKrw,
        vooAdditionalValueKrw,
        additionalValueKrw,
        projectedScenarioValueKrw,
      }),
    );
  }

  const latest = rows.at(-1);
  if (!latest) {
    return blocked("invalid_calculation_result", input.evidence.weights);
  }
  const additionalProfitKrw =
    latest.additionalValueKrw - input.contributionAmountKrw;
  const additionalReturn =
    additionalProfitKrw / input.contributionAmountKrw;
  if (
    !safeSignedCurrency(additionalProfitKrw) ||
    !Number.isFinite(additionalReturn)
  ) {
    return blocked("invalid_calculation_result", input.evidence.weights);
  }

  return Object.freeze({
    status: "ready",
    policy: INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY,
    scenarioId: "fixed_mix",
    weights: input.evidence.weights,
    contributionServiceDate: selected.serviceDate,
    kodexContributionPriceDate: selected.kodexPriceDate,
    vooContributionPriceDate: selected.vooPriceDate,
    endServiceDate: latest.serviceDate,
    contributionAmountKrw: input.contributionAmountKrw,
    allocation: Object.freeze({
      kodexAmountKrw,
      vooAmountKrw,
      kodexUnits,
      vooUnits,
      kodexEndValueKrw: latest.kodexAdditionalValueKrw,
      vooEndValueKrw: latest.vooAdditionalValueKrw,
    }),
    baseEndValueKrw: latest.baseScenarioValueKrw,
    additionalEndValueKrw: latest.additionalValueKrw,
    projectedEndValueKrw: latest.projectedScenarioValueKrw,
    additionalProfitKrw,
    additionalReturn,
    rows: Object.freeze(rows),
    blockers: [] as const,
  });
}

function validComponentPoints(
  points: readonly InvestmentLabContributionScenarioPoint[],
) {
  if (points.length < 2) return false;
  return points.every(
    (point, index) =>
      isRiskDate(point.serviceDate) &&
      isRiskDate(point.valuationPriceDate) &&
      point.valuationPriceDate <= point.serviceDate &&
      positiveFinite(point.unitValueKrw) &&
      safeNonnegativeCurrency(point.baseScenarioValueKrw) &&
      (index === 0 || points[index - 1].serviceDate < point.serviceDate),
  );
}

function isValidEvidence(value: InvestmentLabFixedMixContributionEvidence) {
  return (
    value.points.length >= 2 &&
    value.points.every(
      (point, index) =>
        isRiskDate(point.serviceDate) &&
        isRiskDate(point.kodexPriceDate) &&
        isRiskDate(point.vooPriceDate) &&
        point.kodexPriceDate <= point.serviceDate &&
        point.vooPriceDate <= point.serviceDate &&
        positiveFinite(point.kodexUnitValueKrw) &&
        positiveFinite(point.vooUnitValueKrw) &&
        safeNonnegativeCurrency(point.baseScenarioValueKrw) &&
        (index === 0 ||
          value.points[index - 1].serviceDate < point.serviceDate),
    )
  );
}

function validWeights(weights: InvestmentLabFixedMixWeights) {
  return (
    Number.isSafeInteger(weights.kodexWeightBps) &&
    Number.isSafeInteger(weights.vooWeightBps) &&
    weights.kodexWeightBps > 0 &&
    weights.vooWeightBps > 0 &&
    weights.kodexWeightBps + weights.vooWeightBps === 10_000
  );
}

function weightedValue(
  kodexValue: number,
  vooValue: number,
  weights: InvestmentLabFixedMixWeights,
) {
  return (
    kodexValue * (weights.kodexWeightBps / 10_000) +
    vooValue * (weights.vooWeightBps / 10_000)
  );
}

function blocked(
  reason: InvestmentLabFixedMixContributionBlocker,
  weights: InvestmentLabFixedMixWeights | null = null,
): InvestmentLabFixedMixContributionResult {
  return Object.freeze({
    status: "blocked",
    policy: INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY,
    scenarioId: "fixed_mix",
    weights,
    contributionServiceDate: null,
    kodexContributionPriceDate: null,
    vooContributionPriceDate: null,
    endServiceDate: null,
    contributionAmountKrw: null,
    allocation: null,
    baseEndValueKrw: null,
    additionalEndValueKrw: null,
    projectedEndValueKrw: null,
    additionalProfitKrw: null,
    additionalReturn: null,
    rows: [] as const,
    blockers: Object.freeze([reason]),
  });
}

function positiveFinite(value: number) {
  return Number.isFinite(value) && value > 0;
}

function safeNonnegativeCurrency(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function safeSignedCurrency(value: number) {
  return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
}

function nearlyEqual(left: number, right: number) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      1e-8 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}
