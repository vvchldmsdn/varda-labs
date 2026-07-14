import type {
  SimulationReturnMatrixInstrument,
  SimulationReturnMatrixResult,
} from "./simulation-return-matrix-types.ts";

export type SimulationObservedAlignmentEvidence = Readonly<{
  serviceDateCount: number;
  returnStepCount: number;
  price: SimulationObservedCarrySummary;
  fx:
    | Readonly<{ status: "not_required" }>
    | Readonly<{ status: "required" } & SimulationObservedCarrySummary>;
}>;

type SimulationObservedCarrySummary = Readonly<{
  exactObservationCount: number;
  carriedObservationCount: number;
  maxCarryDaysUsed: number;
  policyMaxCarryDays: number;
}>;

export function projectSimulationObservedAlignmentEvidence(
  matrix: SimulationReturnMatrixResult,
  instrument: SimulationReturnMatrixInstrument,
): SimulationObservedAlignmentEvidence | null {
  const serviceDateCount = matrix.requestedServiceDates.length;
  if (
    matrix.status !== "ready" ||
    serviceDateCount === 0 ||
    matrix.matrix.length !== serviceDateCount - 1
  ) {
    return null;
  }

  const points = matrix.requestedServiceDates.map((serviceDate, index) => {
    const row = matrix.matrix[index === 0 ? 0 : index - 1];
    if (
      !row ||
      (index === 0
        ? row.previousServiceDate !== serviceDate
        : row.serviceDate !== serviceDate)
    ) {
      return null;
    }
    const cell = row.cells.find(
      (candidate) => candidate.instrumentKey === instrument.instrumentKey,
    );
    return index === 0 ? cell?.previous ?? null : cell?.current ?? null;
  });
  if (
    points.some(
      (point) =>
        !point ||
        point.status !== "ready" ||
        !point.sourcePriceDate ||
        !isCarryDayCount(point.priceCarryDays),
    )
  ) {
    return null;
  }

  const price = summarizeCarryDays(
    points.map((point) => point!.priceCarryDays!),
    matrix.policy.maxPriceCarryDays,
  );
  if (!price) return null;

  if (instrument.currency === "KRW") {
    if (
      points.some(
        (point) =>
          point!.sourceFxDate !== null || point!.fxCarryDays !== null,
      )
    ) {
      return null;
    }
    return Object.freeze({
      serviceDateCount,
      returnStepCount: matrix.matrix.length,
      price,
      fx: Object.freeze({ status: "not_required" as const }),
    });
  }

  if (
    points.some(
      (point) =>
        !point!.sourceFxDate || !isCarryDayCount(point!.fxCarryDays),
    )
  ) {
    return null;
  }
  const fx = summarizeCarryDays(
    points.map((point) => point!.fxCarryDays!),
    matrix.policy.maxFxCarryDays,
  );
  if (!fx) return null;

  return Object.freeze({
    serviceDateCount,
    returnStepCount: matrix.matrix.length,
    price,
    fx: Object.freeze({ status: "required" as const, ...fx }),
  });
}

function summarizeCarryDays(
  values: readonly number[],
  policyMaxCarryDays: number,
) {
  if (
    values.length === 0 ||
    values.some((value) => value > policyMaxCarryDays)
  ) {
    return null;
  }
  return Object.freeze({
    exactObservationCount: values.filter((value) => value === 0).length,
    carriedObservationCount: values.filter((value) => value > 0).length,
    maxCarryDaysUsed: Math.max(...values),
    policyMaxCarryDays,
  });
}

function isCarryDayCount(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}
