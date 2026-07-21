import { SIMULATION_RETURN_MATRIX_POLICY } from "../../src/lib/simulation-return-matrix.ts";

export function readyJointMatrix({
  endServiceDate = "2025-04-01",
  override = new Map(),
  flatTraining = false,
} = {}) {
  const requestedServiceDates = dateRangeEndingAt(endServiceDate, 91);
  const kodexKey = "korea|KRW|069500";
  const vooKey = "us|USD|VOO";
  const matrix = Array.from({ length: 90 }, (_, index) => {
    const replacement = override.get(index);
    const trainingFlat = flatTraining && index < 60;
    const kodexReturn =
      replacement?.[0] ??
      (trainingFlat ? 0.001 : ((index % 7) - 3) * 0.002);
    const vooReturn =
      replacement?.[1] ??
      (trainingFlat ? 0.001 : ((index % 5) - 2) * 0.003);
    return {
      previousServiceDate: requestedServiceDates[index],
      serviceDate: requestedServiceDates[index + 1],
      cells: [cell(kodexKey, kodexReturn), cell(vooKey, vooReturn)],
    };
  });

  return {
    status: "ready",
    policy: SIMULATION_RETURN_MATRIX_POLICY,
    requestedServiceDates,
    instruments: [
      {
        instrumentKey: kodexKey,
        market: "korea",
        currency: "KRW",
        ticker: "069500",
      },
      {
        instrumentKey: vooKey,
        market: "us",
        currency: "USD",
        ticker: "VOO",
      },
    ],
    exclusions: [],
    matrix,
    summary: {
      requestedInstrumentCount: 2,
      includedInstrumentCount: 2,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: 91,
      matrixRowCount: 90,
      totalCellCount: 180,
      readyCellCount: 180,
      incompleteCellCount: 0,
      coveragePct: 100,
    },
    sourceSummary: {
      acceptedPriceRows: 182,
      acceptedFxRows: 91,
      ignoredOutOfWindowPriceRows: 0,
      ignoredOutOfWindowFxRows: 0,
    },
    consumerStatus: "matrix_ready",
    blockers: [],
  };
}

function cell(instrumentKey, value) {
  return {
    instrumentKey,
    value,
    previous: evidence(),
    current: evidence(),
  };
}

function evidence() {
  return {
    status: "ready",
    reason: null,
    sourcePriceDate: null,
    priceCarryDays: 0,
    sourceFxDate: null,
    fxCarryDays: 0,
  };
}

function dateRangeEndingAt(endServiceDate, count) {
  const end = Date.parse(`${endServiceDate}T00:00:00.000Z`);
  if (!Number.isFinite(end)) throw new Error("Invalid fixture end service date");
  return Array.from({ length: count }, (_, index) =>
    new Date(end - (count - index - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10),
  );
}
