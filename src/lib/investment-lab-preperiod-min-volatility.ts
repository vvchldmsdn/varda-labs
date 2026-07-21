import {
  buildInvestmentLabFixedMixScenario,
  INVESTMENT_LAB_FIXED_MIX_POLICY,
} from "./investment-lab-fixed-mix.ts";
import type { InvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection.ts";
import type {
  InvestmentLabFixedMixActualRow,
  InvestmentLabFixedMixBlocker,
  InvestmentLabFixedMixComponentPath,
  InvestmentLabFixedMixReturnEvidence,
  InvestmentLabFixedMixScenario,
  InvestmentLabFixedMixWeights,
} from "./investment-lab-fixed-mix-types.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";
import { estimateTwoAssetMinimumVariance } from "./two-asset-minimum-variance.ts";

const TRAINING_RETURN_OBSERVATIONS = 60;
const REQUIRED_COMMON_PRICE_DATES = TRAINING_RETURN_OBSERVATIONS + 1;

export const INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY = Object.freeze({
  version: "preperiod_kodex_voo_minimum_volatility_same_flow_v1",
  instruments: Object.freeze(["korea:KRW:069500", "us:USD:VOO"]),
  trainingCutoff: "strictly_before_observed_start_service_date",
  trainingReturnObservationCount: TRAINING_RETURN_OBSERVATIONS,
  requiredCommonPriceDateCount: REQUIRED_COMMON_PRICE_DATES,
  priceBasis: Object.freeze({
    kodex200: "adjusted_close",
    voo: "raw_close_times_exact_same_date_usdkrw",
  }),
  missingDateHandling: "omit_invalid_or_ambiguous_date_without_interpolation",
  covarianceShrinkage: 0.1,
  varianceFloor: 1e-12,
  annualizationFactor: 252,
  annualizationAxis: "paired_exact_common_market_observation_rows",
  minimumComponentWeightBps: 1,
  allocationBoundary: "initial_value_and_each_external_flow",
  rebalancing: "none",
  providerBackfill: "forbidden",
  interpolation: "forbidden",
  authority: "retrospective_research_only_not_recommendation",
} as const);

export type InvestmentLabPreperiodPriceRow = Readonly<{
  priceDate: string;
  closePrice: string | number | null;
  adjustedClosePrice: string | number | null;
  source: string | null;
}>;

export type InvestmentLabPreperiodFxRow = Readonly<{
  rateDate: string;
  usdKrw: string | number | null;
  source: string | null;
  status: string | null;
}>;

export type InvestmentLabPreperiodMinVolatilityTraining = Readonly<{
  startPriceDate: string;
  endPriceDate: string;
  commonPriceDateCount: number;
  usedPriceDateCount: number;
  returnObservationCount: number;
  estimatedAnnualizedVolatilityPct: number;
}>;

export type InvestmentLabPreperiodMinVolatilityCoverage = Readonly<{
  preperiodKodexSourceRows: number;
  preperiodVooSourceRows: number;
  preperiodFxSourceRows: number;
  validKodexPriceDates: number;
  validVooPriceDates: number;
  validFxDates: number;
  invalidOrAmbiguousKodexDates: number;
  invalidOrAmbiguousVooDates: number;
  invalidOrAmbiguousFxDates: number;
  commonPriceDateCount: number;
}>;

type ResultBase = Readonly<{
  policy: typeof INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY;
  coverage: InvestmentLabPreperiodMinVolatilityCoverage;
  blockers: readonly string[];
}>;

export type InvestmentLabPreperiodMinVolatility =
  | (ResultBase &
      Readonly<{
        status: "ready";
        training: InvestmentLabPreperiodMinVolatilityTraining;
        weights: InvestmentLabFixedMixWeights;
        scenario: Extract<InvestmentLabFixedMixScenario, { status: "ready" }>;
      }>)
  | (ResultBase &
      Readonly<{
        status: "path_unavailable";
        training: InvestmentLabPreperiodMinVolatilityTraining;
        weights: InvestmentLabFixedMixWeights;
        scenario: Extract<
          InvestmentLabFixedMixScenario,
          { status: "unavailable" }
        >;
      }>)
  | (ResultBase &
      Readonly<{
        status: "training_unavailable";
        training: null;
        weights: null;
        scenario: null;
      }>);

export function buildInvestmentLabPreperiodMinVolatility(input: Readonly<{
  observedStartServiceDate: string;
  actualPath: readonly InvestmentLabFixedMixActualRow[];
  kodexPath: InvestmentLabFixedMixComponentPath;
  vooPath: InvestmentLabFixedMixComponentPath;
  kodexReturnEvidence: InvestmentLabFixedMixReturnEvidence | null;
  vooReturnEvidence: InvestmentLabFixedMixReturnEvidence | null;
  kodexPriceRows: readonly InvestmentLabPreperiodPriceRow[];
  vooPriceRows: readonly InvestmentLabPreperiodPriceRow[];
  fxRows: readonly InvestmentLabPreperiodFxRow[];
}>): InvestmentLabPreperiodMinVolatility {
  if (!isRiskDate(input.observedStartServiceDate)) {
    return trainingUnavailable(emptyCoverage(), ["invalid_observed_start"]);
  }

  const kodex = resolveUniqueDateValues(
    input.kodexPriceRows,
    input.observedStartServiceDate,
    (row) => row.priceDate,
    (row) => positiveNumber(row.adjustedClosePrice),
    (row) => hasSource(row.source),
  );
  const voo = resolveUniqueDateValues(
    input.vooPriceRows,
    input.observedStartServiceDate,
    (row) => row.priceDate,
    (row) => positiveNumber(row.closePrice),
    (row) => hasSource(row.source),
  );
  const fx = resolveUniqueDateValues(
    input.fxRows,
    input.observedStartServiceDate,
    (row) => row.rateDate,
    (row) => positiveNumber(row.usdKrw),
    (row) =>
      hasSource(row.source) &&
      String(row.status ?? "").trim().toLowerCase() === "ok",
  );
  const commonDates = [...kodex.values.keys()]
    .filter((date) => voo.values.has(date) && fx.values.has(date))
    .sort();
  const coverage = Object.freeze({
    preperiodKodexSourceRows: kodex.sourceRows,
    preperiodVooSourceRows: voo.sourceRows,
    preperiodFxSourceRows: fx.sourceRows,
    validKodexPriceDates: kodex.values.size,
    validVooPriceDates: voo.values.size,
    validFxDates: fx.values.size,
    invalidOrAmbiguousKodexDates: kodex.invalidOrAmbiguousDates,
    invalidOrAmbiguousVooDates: voo.invalidOrAmbiguousDates,
    invalidOrAmbiguousFxDates: fx.invalidOrAmbiguousDates,
    commonPriceDateCount: commonDates.length,
  });
  if (commonDates.length < REQUIRED_COMMON_PRICE_DATES) {
    return trainingUnavailable(coverage, [
      "insufficient_common_preperiod_rows",
    ]);
  }

  const trainingDates = commonDates.slice(-REQUIRED_COMMON_PRICE_DATES);
  const kodexValues = trainingDates.map((date) => kodex.values.get(date)!);
  const vooKrwValues = trainingDates.map(
    (date) => voo.values.get(date)! * fx.values.get(date)!,
  );
  const kodexReturns = simpleReturns(kodexValues);
  const vooReturns = simpleReturns(vooKrwValues);
  if (!kodexReturns || !vooReturns) {
    return trainingUnavailable(coverage, ["training_return_invalid"]);
  }
  const estimate = estimateTwoAssetMinimumVariance({
    leftReturns: kodexReturns,
    rightReturns: vooReturns,
    covarianceShrinkage:
      INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY.covarianceShrinkage,
    varianceFloor:
      INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY.varianceFloor,
    annualizationFactor:
      INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY.annualizationFactor,
    minimumComponentWeightBps:
      INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY.minimumComponentWeightBps,
  });
  if (!estimate) {
    return trainingUnavailable(coverage, ["weight_estimation_blocked"]);
  }

  const weights = Object.freeze({
    kodexWeightBps: estimate.leftWeightBps,
    vooWeightBps: estimate.rightWeightBps,
  });
  const training = Object.freeze({
    startPriceDate: trainingDates[0],
    endPriceDate: trainingDates.at(-1)!,
    commonPriceDateCount: commonDates.length,
    usedPriceDateCount: trainingDates.length,
    returnObservationCount: kodexReturns.length,
    estimatedAnnualizedVolatilityPct:
      estimate.estimatedAnnualizedVolatilityPct,
  });
  const scenario = buildInvestmentLabFixedMixScenario({
    selection: selectionFromWeights(weights),
    actualPath: input.actualPath,
    kodexPath: input.kodexPath,
    vooPath: input.vooPath,
    kodexReturnEvidence: input.kodexReturnEvidence,
    vooReturnEvidence: input.vooReturnEvidence,
  });
  if (scenario.status !== "ready") {
    return Object.freeze({
      status: "path_unavailable" as const,
      policy: INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY,
      training,
      weights,
      scenario,
      coverage,
      blockers: Object.freeze([...scenario.blockers]),
    });
  }
  return Object.freeze({
    status: "ready" as const,
    policy: INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY,
    training,
    weights,
    scenario,
    coverage,
    blockers: [] as const,
  });
}

export function unavailableInvestmentLabPreperiodMinVolatility(
  blockers: readonly string[],
): InvestmentLabPreperiodMinVolatility {
  return trainingUnavailable(emptyCoverage(), blockers);
}

export function markInvestmentLabPreperiodMinVolatilityPathUnavailable(
  source: InvestmentLabPreperiodMinVolatility,
  blocker: Extract<
    InvestmentLabFixedMixBlocker,
    "account_composition_incomplete" | "account_composition_mismatch"
  >,
): InvestmentLabPreperiodMinVolatility {
  if (!source.training || !source.weights) {
    return source;
  }
  return Object.freeze({
    status: "path_unavailable" as const,
    policy: INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY,
    training: source.training,
    weights: source.weights,
    scenario: unavailableScenario(source.weights, blocker),
    coverage: source.coverage,
    blockers: [blocker] as const,
  });
}

function resolveUniqueDateValues<T>(
  rows: readonly T[],
  cutoffDate: string,
  dateOf: (row: T) => string,
  valueOf: (row: T) => number | null,
  evidenceReady: (row: T) => boolean,
) {
  const groups = new Map<string, T[]>();
  let sourceRows = 0;
  for (const row of rows) {
    const date = dateOf(row);
    if (!isRiskDate(date) || date >= cutoffDate) continue;
    sourceRows += 1;
    const group = groups.get(date) ?? [];
    group.push(row);
    groups.set(date, group);
  }

  const values = new Map<string, number>();
  let invalidOrAmbiguousDates = 0;
  for (const [date, group] of groups) {
    const value = group.length === 1 ? valueOf(group[0]) : null;
    if (value === null || !evidenceReady(group[0])) {
      invalidOrAmbiguousDates += 1;
      continue;
    }
    values.set(date, value);
  }
  return { values, sourceRows, invalidOrAmbiguousDates };
}

function simpleReturns(values: readonly number[]) {
  const returns = values.slice(1).map((value, index) => {
    const previous = values[index];
    return previous > 0 ? value / previous - 1 : Number.NaN;
  });
  return returns.length === TRAINING_RETURN_OBSERVATIONS &&
    returns.every((value) => Number.isFinite(value) && value > -1)
    ? returns
    : null;
}

function selectionFromWeights(
  weights: InvestmentLabFixedMixWeights,
): InvestmentLabFixedMixSelection {
  return Object.freeze({
    status: "selected" as const,
    kodexWeightPct: weights.kodexWeightBps / 100,
    vooWeightPct: weights.vooWeightBps / 100,
    kodexWeightBps: weights.kodexWeightBps,
    vooWeightBps: weights.vooWeightBps,
    reason: null,
  });
}

function trainingUnavailable(
  coverage: InvestmentLabPreperiodMinVolatilityCoverage,
  blockers: readonly string[],
): InvestmentLabPreperiodMinVolatility {
  return Object.freeze({
    status: "training_unavailable" as const,
    policy: INVESTMENT_LAB_PREPERIOD_MIN_VOLATILITY_POLICY,
    training: null,
    weights: null,
    scenario: null,
    coverage,
    blockers: Object.freeze([...new Set(blockers)].sort()),
  });
}

function unavailableScenario(
  weights: InvestmentLabFixedMixWeights,
  blocker: Extract<
    InvestmentLabFixedMixBlocker,
    "account_composition_incomplete" | "account_composition_mismatch"
  >,
): Extract<InvestmentLabFixedMixScenario, { status: "unavailable" }> {
  return Object.freeze({
    status: "unavailable" as const,
    policy: INVESTMENT_LAB_FIXED_MIX_POLICY,
    weights,
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: Object.freeze({
      componentFlowSourceCount: 0 as const,
      scenarioFlowLegCount: 0 as const,
      splitExecutionDateRows: 0 as const,
      pendingComparisonRows: 0 as const,
    }),
    blockers: [blocker] as const,
  });
}

function emptyCoverage(): InvestmentLabPreperiodMinVolatilityCoverage {
  return Object.freeze({
    preperiodKodexSourceRows: 0,
    preperiodVooSourceRows: 0,
    preperiodFxSourceRows: 0,
    validKodexPriceDates: 0,
    validVooPriceDates: 0,
    validFxDates: 0,
    invalidOrAmbiguousKodexDates: 0,
    invalidOrAmbiguousVooDates: 0,
    invalidOrAmbiguousFxDates: 0,
    commonPriceDateCount: 0,
  });
}

function positiveNumber(value: string | number | null) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function hasSource(value: string | null) {
  return typeof value === "string" && value.trim().length > 0;
}
