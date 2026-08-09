import { allocateBasisPointsByValue } from "./basis-point-allocation.ts";
import {
  buildInvestmentLabAnchorAllocationPath,
  type InvestmentLabAnchorAllocationPath,
} from "./investment-lab-anchor-allocation-path.ts";
import type {
  InvestmentLabAnchorInstrument,
  InvestmentLabAnchorSelection,
} from "./investment-lab-anchor-basket-anchor.ts";
import type {
  InvestmentLabAnchorEvidenceResolution,
  InvestmentLabAnchorFxRow,
  InvestmentLabAnchorPriceRow,
} from "./investment-lab-anchor-basket-evidence.ts";
import type { InvestmentLabActualPathPoint } from "./investment-lab-counterfactual-path.ts";
import {
  evaluateInvestmentLabOptimizerTrainingMetrics,
  estimateInvestmentLabOptimizerCandidates,
  type InvestmentLabOptimizerObjective,
  type InvestmentLabOptimizerTrainingMetrics,
} from "./investment-lab-preperiod-optimizer-math.ts";
import type { InvestmentLabModifiedDietzPeriod } from "./investment-lab-modified-dietz.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";

const TRAINING_RETURN_OBSERVATIONS = 60;
const REQUIRED_COMMON_PRICE_DATES = TRAINING_RETURN_OBSERVATIONS + 1;
const MAXIMUM_INSTRUMENT_WEIGHT_BPS = 5_000;
const MAXIMUM_OPTIMIZER_INSTRUMENTS = 20;

export const INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY = Object.freeze({
  version: "owner_anchor_preperiod_optimizer_holdout_v1",
  universe: "exact_owner_account_anchor_instruments",
  trainingCutoff: "strictly_before_anchor_service_date",
  trainingReturnObservationCount: TRAINING_RETURN_OBSERVATIONS,
  requiredCommonPriceDateCount: REQUIRED_COMMON_PRICE_DATES,
  priceBasis: "single_admitted_private_kis_raw_close",
  usdConversion: "exact_same_date_stored_usdkrw",
  missingDateHandling: "omit_invalid_or_ambiguous_date_without_interpolation",
  maximumInstrumentWeightBps: MAXIMUM_INSTRUMENT_WEIGHT_BPS,
  maximumInstrumentWeightBasis: "optimized_sleeve",
  maximumInstrumentCount: MAXIMUM_OPTIMIZER_INSTRUMENTS,
  manualValuationHandling:
    "fixed_at_anchor_weight_and_excluded_from_training_objective",
  riskFreeRate: "zero_research_assumption",
  holdoutPath: "same_anchor_same_external_flows_no_rebalancing",
  providerBackfill: "forbidden",
  authority: "retrospective_research_candidate_not_recommendation",
} as const);

export type InvestmentLabPreperiodOptimizerWeight = Readonly<{
  instrumentKey: string;
  label: string;
  weightBps: number;
  allocationRole: "optimized" | "fixed_manual";
}>;

export type InvestmentLabPreperiodOptimizerCandidate = Readonly<{
  objective: InvestmentLabOptimizerObjective;
  weights: readonly InvestmentLabPreperiodOptimizerWeight[];
  trainingMetrics: InvestmentLabOptimizerTrainingMetrics;
  searchMethod:
    | "bounded_terminal_return_exact"
    | "shrunk_covariance_warm_start_and_deterministic_refinement"
    | "deterministic_low_discrepancy_and_coordinate_refinement";
  scenario: InvestmentLabAnchorAllocationPath;
}>;

export type InvestmentLabPreperiodOptimizer = Readonly<{
  status: "ready" | "training_unavailable" | "path_unavailable";
  policy: typeof INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY;
  training: Readonly<{
    startPriceDate: string;
    endPriceDate: string;
    commonPriceDateCount: number;
    usedPriceDateCount: number;
    returnObservationCount: number;
    instrumentCount: number;
    fixedManualInstrumentCount: number;
    optimizedSleeveWeightBps: number;
  }> | null;
  candidates: readonly InvestmentLabPreperiodOptimizerCandidate[];
  coverage: Readonly<{
    sourcePriceRows: number;
    sourceFxRows: number;
    commonPriceDateCount: number;
    invalidOrAmbiguousPriceDates: number;
    invalidOrAmbiguousFxDates: number;
    fixedManualInstrumentCount: number;
    instrumentEvidence: readonly Readonly<{
      instrumentKey: string;
      validPriceDateCount: number;
    }>[];
  }>;
  blockers: readonly string[];
}>;

export function buildInvestmentLabPreperiodOptimizer(input: Readonly<{
  anchor: InvestmentLabAnchorSelection;
  actualPath: readonly InvestmentLabActualPathPoint[];
  evidence: InvestmentLabAnchorEvidenceResolution | null;
  actualReturn: number | null;
  actualPeriods?: readonly InvestmentLabModifiedDietzPeriod[];
  priceRows: readonly InvestmentLabAnchorPriceRow[];
  fxRows: readonly InvestmentLabAnchorFxRow[];
}>): InvestmentLabPreperiodOptimizer {
  const instruments = [...input.anchor.instruments].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
  if (input.anchor.status !== "ready" || !input.anchor.selectedAnchorDate) {
    return unavailable(input, ["anchor_selection_unavailable"]);
  }
  const optimizedInstruments = instruments.filter(
    (instrument) => instrument.valuationModel === "listed_close",
  );
  const fixedManualInstruments = instruments.filter(
    (instrument) => instrument.valuationModel === "stored_manual",
  );
  if (
    optimizedInstruments.length < 2 ||
    optimizedInstruments.length > MAXIMUM_OPTIMIZER_INSTRUMENTS
  ) {
    return unavailable(input, ["unsupported_optimizer_instrument_count"]);
  }
  const anchorAllocations = allocateBasisPointsByValue(
    instruments.map((instrument) => ({
      key: instrument.key,
      value: instrument.storedMarketValueKrw,
    })),
  );
  if (!anchorAllocations) {
    return unavailable(input, ["invalid_anchor_market_values"]);
  }
  const fixedManualWeightBps = fixedManualInstruments.reduce(
    (sum, instrument) => sum + (anchorAllocations.get(instrument.key) ?? 0),
    0,
  );
  const optimizedSleeveWeightBps = 10_000 - fixedManualWeightBps;
  if (optimizedSleeveWeightBps <= 0) {
    return unavailable(input, ["optimizer_sleeve_has_no_weight"]);
  }

  const priceEvidence = optimizedInstruments.map((instrument) =>
    resolveInstrumentPriceEvidence(
      input.priceRows,
      instrument,
      input.anchor.selectedAnchorDate!,
    ),
  );
  const requiresFx = optimizedInstruments.some(
    (instrument) => instrument.currency === "USD",
  );
  const fxEvidence = resolveFxEvidence(
    input.fxRows,
    input.anchor.selectedAnchorDate,
  );
  const commonDates = [...(priceEvidence[0]?.values.keys() ?? [])]
    .filter(
      (date) =>
        priceEvidence.every((evidence) => evidence.values.has(date)) &&
        (!requiresFx || fxEvidence.values.has(date)),
    )
    .sort();
  const coverage = Object.freeze({
    sourcePriceRows: priceEvidence.reduce(
      (sum, evidence) => sum + evidence.sourceRows,
      0,
    ),
    sourceFxRows: requiresFx ? fxEvidence.sourceRows : 0,
    commonPriceDateCount: commonDates.length,
    invalidOrAmbiguousPriceDates: priceEvidence.reduce(
      (sum, evidence) => sum + evidence.invalidOrAmbiguousDates,
      0,
    ),
    invalidOrAmbiguousFxDates: requiresFx
      ? fxEvidence.invalidOrAmbiguousDates
      : 0,
    fixedManualInstrumentCount: fixedManualInstruments.length,
    instrumentEvidence: Object.freeze(
      optimizedInstruments.map((instrument, index) =>
        Object.freeze({
          instrumentKey: instrument.key,
          validPriceDateCount: priceEvidence[index].values.size,
        }),
      ),
    ),
  });
  if (commonDates.length < REQUIRED_COMMON_PRICE_DATES) {
    return unavailable(input, ["insufficient_common_preperiod_rows"], coverage);
  }

  const trainingDates = commonDates.slice(-REQUIRED_COMMON_PRICE_DATES);
  const growthSeries = optimizedInstruments.map((instrument, instrumentIndex) =>
    trainingDates.map((date) => {
      const price = priceEvidence[instrumentIndex].values.get(date)!;
      return instrument.currency === "USD"
        ? price * fxEvidence.values.get(date)!
        : price;
    }),
  );
  const storedTotal = optimizedInstruments.reduce(
    (sum, instrument) => sum + instrument.storedMarketValueKrw,
    0,
  );
  if (!Number.isFinite(storedTotal) || storedTotal <= 0) {
    return unavailable(input, ["invalid_anchor_market_values"], coverage);
  }
  const estimates = estimateInvestmentLabOptimizerCandidates({
    growthSeries,
    currentWeights: optimizedInstruments.map(
      (instrument) => instrument.storedMarketValueKrw / storedTotal,
    ),
    maximumWeight: MAXIMUM_INSTRUMENT_WEIGHT_BPS / 10_000,
  });
  if (!estimates) {
    return unavailable(input, ["optimizer_estimation_blocked"], coverage);
  }

  const candidates: InvestmentLabPreperiodOptimizerCandidate[] = [];
  for (const estimate of estimates) {
    const allocations = allocateBasisPointsByValue(
      optimizedInstruments.map((instrument, index) => ({
        key: instrument.key,
        value: estimate.weights[index],
      })),
      optimizedSleeveWeightBps,
    );
    if (!allocations) {
      return unavailable(input, ["optimizer_basis_point_rounding_blocked"], coverage);
    }
    const weights = instruments.map((instrument) => {
      const fixedManual = instrument.valuationModel === "stored_manual";
      return Object.freeze({
        instrumentKey: instrument.key,
        label: instrument.label,
        weightBps: fixedManual
          ? (anchorAllocations.get(instrument.key) ?? 0)
          : (allocations.get(instrument.key) ?? 0),
        allocationRole: fixedManual ? ("fixed_manual" as const) : ("optimized" as const),
      });
    });
    if (
      weights.some(
        (weight) =>
          weight.allocationRole === "optimized" &&
          weight.weightBps > Math.ceil(optimizedSleeveWeightBps / 2),
      )
    ) {
      return unavailable(input, ["optimizer_weight_cap_exceeded"], coverage);
    }
    const roundedWeights = optimizedInstruments.map(
      (instrument) =>
        (allocations.get(instrument.key) ?? 0) / optimizedSleeveWeightBps,
    );
    const trainingMetrics = evaluateInvestmentLabOptimizerTrainingMetrics({
      growthSeries,
      weights: roundedWeights,
    });
    if (!trainingMetrics) {
      return unavailable(input, ["optimizer_metric_evaluation_blocked"], coverage);
    }
    const scenario = buildInvestmentLabAnchorAllocationPath({
      anchor: input.anchor,
      actualPath: input.actualPath,
      evidence: input.evidence,
      actualReturn: input.actualReturn,
      actualPeriods: input.actualPeriods,
      weights: weights.map((weight) => ({
        instrumentKey: weight.instrumentKey,
        weight: weight.weightBps / 10_000,
      })),
    });
    candidates.push(
      Object.freeze({
        objective: estimate.objective,
        weights: Object.freeze(weights),
        trainingMetrics,
        searchMethod: estimate.searchMethod,
        scenario,
      }),
    );
  }

  const pathBlockers = candidates.flatMap((candidate) =>
    candidate.scenario.blockers.map((blocker) => blocker.reason),
  );
  return Object.freeze({
    status: pathBlockers.length === 0 ? "ready" : "path_unavailable",
    policy: INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY,
    training: Object.freeze({
      startPriceDate: trainingDates[0],
      endPriceDate: trainingDates.at(-1)!,
      commonPriceDateCount: commonDates.length,
      usedPriceDateCount: trainingDates.length,
      returnObservationCount: TRAINING_RETURN_OBSERVATIONS,
      instrumentCount: optimizedInstruments.length,
      fixedManualInstrumentCount: fixedManualInstruments.length,
      optimizedSleeveWeightBps,
    }),
    candidates: Object.freeze(candidates),
    coverage,
    blockers: Object.freeze([...new Set(pathBlockers)].sort()),
  });
}

function resolveInstrumentPriceEvidence(
  rows: readonly InvestmentLabAnchorPriceRow[],
  instrument: InvestmentLabAnchorInstrument,
  cutoffDate: string,
) {
  const groups = new Map<string, InvestmentLabAnchorPriceRow[]>();
  let sourceRows = 0;
  for (const row of rows) {
    if (
      sourceInstrumentKey(row) !== instrument.key ||
      !isRiskDate(row.priceDate) ||
      row.priceDate >= cutoffDate
    ) {
      continue;
    }
    sourceRows += 1;
    const group = groups.get(row.priceDate) ?? [];
    group.push(row);
    groups.set(row.priceDate, group);
  }
  const values = new Map<string, number>();
  let invalidOrAmbiguousDates = 0;
  for (const [date, group] of groups) {
    const value = group.length === 1 ? positiveNumber(group[0].closePrice) : null;
    if (value === null || !normalizeText(group[0]?.source)) {
      invalidOrAmbiguousDates += 1;
    } else {
      values.set(date, value);
    }
  }
  return Object.freeze({ values, sourceRows, invalidOrAmbiguousDates });
}

function resolveFxEvidence(
  rows: readonly InvestmentLabAnchorFxRow[],
  cutoffDate: string,
) {
  const groups = new Map<string, InvestmentLabAnchorFxRow[]>();
  let sourceRows = 0;
  for (const row of rows) {
    if (!isRiskDate(row.rateDate) || row.rateDate >= cutoffDate) continue;
    sourceRows += 1;
    const group = groups.get(row.rateDate) ?? [];
    group.push(row);
    groups.set(row.rateDate, group);
  }
  const values = new Map<string, number>();
  let invalidOrAmbiguousDates = 0;
  for (const [date, group] of groups) {
    const value = group.length === 1 ? positiveNumber(group[0].usdKrw) : null;
    if (
      value === null ||
      normalizeText(group[0]?.status).toLowerCase() !== "ok" ||
      !normalizeText(group[0]?.source)
    ) {
      invalidOrAmbiguousDates += 1;
    } else {
      values.set(date, value);
    }
  }
  return Object.freeze({ values, sourceRows, invalidOrAmbiguousDates });
}

function unavailable(
  input: Readonly<{
    priceRows: readonly InvestmentLabAnchorPriceRow[];
    fxRows: readonly InvestmentLabAnchorFxRow[];
  }>,
  blockers: readonly string[],
  coverage: InvestmentLabPreperiodOptimizer["coverage"] = emptyCoverage(input),
): InvestmentLabPreperiodOptimizer {
  return Object.freeze({
    status: "training_unavailable" as const,
    policy: INVESTMENT_LAB_PREPERIOD_OPTIMIZER_POLICY,
    training: null,
    candidates: [] as const,
    coverage,
    blockers: Object.freeze([...new Set(blockers)].sort()),
  });
}

function emptyCoverage(input: Readonly<{
  priceRows: readonly InvestmentLabAnchorPriceRow[];
  fxRows: readonly InvestmentLabAnchorFxRow[];
}>): InvestmentLabPreperiodOptimizer["coverage"] {
  return Object.freeze({
    sourcePriceRows: input.priceRows.length,
    sourceFxRows: input.fxRows.length,
    commonPriceDateCount: 0,
    invalidOrAmbiguousPriceDates: 0,
    invalidOrAmbiguousFxDates: 0,
    fixedManualInstrumentCount: 0,
    instrumentEvidence: [] as const,
  });
}

function sourceInstrumentKey(row: InvestmentLabAnchorPriceRow) {
  const ticker = normalizeText(row.ticker).toUpperCase();
  const market = normalizeText(row.market).toLowerCase();
  const currency = normalizeText(row.currency).toUpperCase();
  return ticker && market && currency ? `${market}:${currency}:${ticker}` : null;
}

function positiveNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
