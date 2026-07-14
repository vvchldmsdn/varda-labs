import type { SimulationObservedAlignmentEvidence } from "./simulation-return-matrix-alignment-evidence.ts";

export type SimulationObservedReturnAlignmentInput = Readonly<{
  id: string;
  ticker: string;
  name: string;
  currency: "KRW" | "USD";
  status: "matrix_ready" | "unavailable";
  alignmentEvidence: SimulationObservedAlignmentEvidence | null;
}>;

export function buildSimulationObservedReturnAlignment(input: {
  comparisonStatus: "ready" | "unavailable";
  inputs: readonly SimulationObservedReturnAlignmentInput[];
  expectedReturnStepCount: number;
}) {
  if (
    !Number.isSafeInteger(input.expectedReturnStepCount) ||
    input.expectedReturnStepCount <= 0 ||
    input.comparisonStatus !== "ready" ||
    input.inputs.length !== 2 ||
    new Set(input.inputs.map((item) => item.id)).size !== 2
  ) {
    return unavailable("comparison_unavailable");
  }

  const expectedServiceDateCount = input.expectedReturnStepCount + 1;
  if (
    input.inputs.some((item) =>
      hasInvalidEvidence(
        item,
        input.expectedReturnStepCount,
        expectedServiceDateCount,
      ),
    )
  ) {
    return unavailable("invalid_alignment_evidence");
  }

  return Object.freeze({
    status: "ready" as const,
    reason: null,
    serviceDateCount: expectedServiceDateCount,
    returnStepCount: input.expectedReturnStepCount,
    instruments: Object.freeze(
      input.inputs.map((item) =>
        Object.freeze({
          id: item.id,
          ticker: item.ticker,
          name: item.name,
          currency: item.currency,
          price: item.alignmentEvidence!.price,
          fx: item.alignmentEvidence!.fx,
        }),
      ),
    ),
  });
}

function hasInvalidEvidence(
  item: SimulationObservedReturnAlignmentInput,
  expectedReturnStepCount: number,
  expectedServiceDateCount: number,
) {
  const evidence = item.alignmentEvidence;
  if (
    item.status !== "matrix_ready" ||
    !evidence ||
    evidence.returnStepCount !== expectedReturnStepCount ||
    evidence.serviceDateCount !== expectedServiceDateCount ||
    !isCompleteCarrySummary(evidence.price, expectedServiceDateCount)
  ) {
    return true;
  }
  if (item.currency === "KRW") {
    return evidence.fx.status !== "not_required";
  }
  return (
    evidence.fx.status !== "required" ||
    !isCompleteCarrySummary(evidence.fx, expectedServiceDateCount)
  );
}

function isCompleteCarrySummary(
  summary: Readonly<{
    exactObservationCount: number;
    carriedObservationCount: number;
    maxCarryDaysUsed: number;
    policyMaxCarryDays: number;
  }>,
  expectedCount: number,
) {
  return (
    Number.isSafeInteger(summary.exactObservationCount) &&
    Number.isSafeInteger(summary.carriedObservationCount) &&
    summary.exactObservationCount >= 0 &&
    summary.carriedObservationCount >= 0 &&
    summary.exactObservationCount + summary.carriedObservationCount ===
      expectedCount &&
    Number.isSafeInteger(summary.maxCarryDaysUsed) &&
    summary.maxCarryDaysUsed >= 0 &&
    summary.maxCarryDaysUsed <= summary.policyMaxCarryDays &&
    (summary.carriedObservationCount === 0
      ? summary.maxCarryDaysUsed === 0
      : summary.maxCarryDaysUsed > 0)
  );
}

function unavailable(
  reason: "comparison_unavailable" | "invalid_alignment_evidence",
) {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    serviceDateCount: 0,
    returnStepCount: 0,
    instruments: Object.freeze([]),
  });
}
