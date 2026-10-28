import {
  normalizeSimulationScenarioVectorReviewInput,
  type NormalizedSimulationScenarioInstrument,
  type NormalizedSimulationScenarioWeight,
  type SimulationScenarioInstrumentInput,
  type SimulationScenarioWeightInput,
} from "./simulation-scenario-vector-review-input.ts";
import {
  addSimulationScenarioVectorBlocker,
  sortSimulationScenarioVectorBlockers,
  uniqueSimulationScenarioRowsByKey,
  validateSimulationScenarioMatrixUniverse,
  validateSimulationScenarioVectorMetadata,
  validateSimulationScenarioWeights,
  type SimulationScenarioVectorReviewBlocker,
} from "./simulation-scenario-vector-review-rules.ts";
import {
  SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT,
  SIMULATION_PORTFOLIO_PATH_POLICY_ID,
  canonicalizeSimulationScenarioVector,
  compareSimulationScenarioVectorRows,
  hashSimulationScenarioVector,
  type SimulationScenarioVectorRow,
} from "./simulation-scenario-vector-review-serialization.ts";

export const SIMULATION_SCENARIO_VECTOR_REVIEW_PACKET_POLICY = Object.freeze({
  version: "simulation_scenario_vector_review_packet_v1",
  portfolioPathPolicyId: SIMULATION_PORTFOLIO_PATH_POLICY_ID,
  gate0ApprovalCommit: SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT,
  weightUnit: "integer_basis_points",
  weightTotalBps: 10_000,
  approvalState: "unapproved",
  matrixUniverseAuthority: "caller_supplied_unverified",
  automaticNormalization: "forbidden",
  strategicTargetReuse: "forbidden",
  executionHashBinding: "forbidden_in_review_packet",
  persistence: "forbidden",
} as const);

export function buildSimulationScenarioVectorReviewPacket(input: {
  scenarioId: string;
  scenarioVersion: string;
  matrixInstruments: readonly SimulationScenarioInstrumentInput[];
  weights: readonly SimulationScenarioWeightInput[];
}) {
  const normalized = normalizeSimulationScenarioVectorReviewInput(input);
  const blockers: SimulationScenarioVectorReviewBlocker[] = [];

  validateSimulationScenarioVectorMetadata(normalized, blockers);
  validateSimulationScenarioMatrixUniverse(
    normalized.matrixInstruments,
    blockers,
  );
  validateSimulationScenarioWeights(normalized.weights, blockers);

  const matrixByKey = uniqueSimulationScenarioRowsByKey(
    normalized.matrixInstruments,
  );
  const weightsByKey = uniqueSimulationScenarioRowsByKey(normalized.weights);

  for (const instrument of normalized.matrixInstruments) {
    if (instrument.instrumentKey && !weightsByKey.has(instrument.instrumentKey)) {
      addSimulationScenarioVectorBlocker(
        blockers,
        "missing_instrument_weight",
        instrument.instrumentKey,
      );
    }
  }
  for (const weight of normalized.weights) {
    if (weight.instrumentKey && !matrixByKey.has(weight.instrumentKey)) {
      addSimulationScenarioVectorBlocker(
        blockers,
        "external_instrument",
        weight.instrumentKey,
      );
    }
  }

  const rows = normalized.matrixInstruments
    .map((instrument) =>
      projectReviewRow(
        instrument,
        instrument.instrumentKey
          ? weightsByKey.get(instrument.instrumentKey) ?? null
          : null,
      ),
    )
    .sort(compareReviewRows);
  const vector = rows
    .filter(isCompleteReviewRow)
    .map(toScenarioVectorRow)
    .sort(compareSimulationScenarioVectorRows);
  const weightTotalBps = normalized.weights.reduce(
    (sum, row) => sum + (row.weightBps ?? 0),
    0,
  );
  if (
    !Number.isSafeInteger(weightTotalBps) ||
    weightTotalBps !==
      SIMULATION_SCENARIO_VECTOR_REVIEW_PACKET_POLICY.weightTotalBps
  ) {
    addSimulationScenarioVectorBlocker(blockers, "weight_total_invalid");
  }

  const sortedBlockers = sortSimulationScenarioVectorBlockers(blockers);
  const reviewable = sortedBlockers.length === 0;
  const canonicalSerialization = reviewable
    ? canonicalizeSimulationScenarioVector({
        scenarioId: normalized.scenarioId as string,
        scenarioVersion: normalized.scenarioVersion as string,
        vector,
      })
    : null;

  return Object.freeze({
    status: reviewable ? "reviewable" : "invalid",
    approvalState: "unapproved",
    policy: SIMULATION_SCENARIO_VECTOR_REVIEW_PACKET_POLICY,
    scenarioId: normalized.scenarioId,
    scenarioVersion: normalized.scenarioVersion,
    summary: Object.freeze({
      matrixInstrumentCount: normalized.matrixInstruments.length,
      weightRowCount: normalized.weights.length,
      vectorRowCount: vector.length,
      positiveWeightCount: rows.filter(
        (row) => row.weightBps !== null && row.weightBps > 0,
      ).length,
      zeroWeightCount: rows.filter((row) => row.weightBps === 0).length,
      weightTotalBps,
    }),
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
    canonicalVector: reviewable
      ? Object.freeze(vector.map((row) => Object.freeze(row)))
      : null,
    canonicalSerialization,
    scenarioVectorHash: canonicalSerialization
      ? hashSimulationScenarioVector(canonicalSerialization)
      : null,
    blockers: Object.freeze(sortedBlockers),
  } as const);
}

function projectReviewRow(
  instrument: NormalizedSimulationScenarioInstrument,
  weight: NormalizedSimulationScenarioWeight | null,
) {
  return {
    instrumentKey: instrument.instrumentKey,
    market: instrument.market,
    currency: instrument.currency,
    ticker: instrument.ticker,
    weightBps: weight?.weightBps ?? null,
  };
}

type ReviewRow = ReturnType<typeof projectReviewRow>;

function isCompleteReviewRow(
  row: ReviewRow,
): row is ReviewRow & {
  market: string;
  currency: string;
  ticker: string;
  weightBps: number;
} {
  return (
    row.market !== null &&
    row.currency !== null &&
    row.ticker !== null &&
    row.weightBps !== null
  );
}

function toScenarioVectorRow(row: ReviewRow): SimulationScenarioVectorRow {
  return {
    market: row.market as string,
    currency: row.currency as string,
    ticker: row.ticker as string,
    weightBps: row.weightBps as number,
  };
}

function compareReviewRows(left: ReviewRow, right: ReviewRow) {
  return String(left.instrumentKey).localeCompare(String(right.instrumentKey));
}
