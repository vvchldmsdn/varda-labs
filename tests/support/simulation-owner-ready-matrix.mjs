import { PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY } from "../../src/lib/simulation-return-matrix.ts";

const INSTRUMENTS = Object.freeze([
  instrument("korea|KRW|AAA", "korea", "KRW", "AAA"),
  instrument("korea|KRW|BBB", "korea", "KRW", "BBB"),
  instrument("us|USD|CCC", "us", "USD", "CCC"),
]);

export function readyOwnerMatrix({
  instrumentCount = 3,
  returnOverrides = new Map(),
} = {}) {
  const requestedServiceDates = Array.from({ length: 91 }, (_, index) =>
    isoDate(index),
  );
  const instruments = INSTRUMENTS.slice(0, instrumentCount);
  const matrix = Array.from({ length: 90 }, (_, index) => ({
    previousServiceDate: requestedServiceDates[index],
    serviceDate: requestedServiceDates[index + 1],
    cells: instruments.map((row) => ({
      instrumentKey: row.instrumentKey,
      value:
        returnOverrides.get(`${row.ticker}:${index}`) ??
        defaultReturn(row.ticker, index),
      previous: evidence(requestedServiceDates[index]),
      current: evidence(requestedServiceDates[index + 1]),
    })),
  }));
  return {
    status: "ready",
    policy: PRIVATE_OWNER_RAW_CLOSE_SIMULATION_RETURN_MATRIX_POLICY,
    requestedServiceDates,
    instruments,
    exclusions: [],
    matrix,
    summary: {
      requestedInstrumentCount: instruments.length,
      includedInstrumentCount: instruments.length,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: requestedServiceDates.length,
      matrixRowCount: matrix.length,
      totalCellCount: matrix.length * instruments.length,
      readyCellCount: matrix.length * instruments.length,
      incompleteCellCount: 0,
      coveragePct: 100,
    },
    sourceSummary: {
      acceptedPriceRows: requestedServiceDates.length * instruments.length,
      acceptedFxRows: requestedServiceDates.length,
      ignoredOutOfWindowPriceRows: 0,
      ignoredOutOfWindowFxRows: 0,
    },
    consumerStatus: "matrix_ready",
    blockers: [],
  };
}

export function ownerWeights(weightBps, instrumentCount = weightBps.length) {
  return INSTRUMENTS.slice(0, instrumentCount).map((row, index) => ({
    ...row,
    weightBps: weightBps[index],
  }));
}

function instrument(instrumentKey, market, currency, ticker) {
  return Object.freeze({ instrumentKey, market, currency, ticker });
}

function defaultReturn(ticker, index) {
  if (ticker === "AAA") return index % 2 === 0 ? 0.035 : -0.03;
  if (ticker === "BBB") return 0.001 + (index % 3) * 0.0001;
  return index % 4 === 0 ? 0.012 : -0.002;
}

function evidence(date) {
  return {
    status: "ready",
    reason: null,
    sourcePriceDate: date,
    priceCarryDays: 0,
    sourceFxDate: date,
    fxCarryDays: 0,
  };
}

function isoDate(offset) {
  const date = new Date(Date.UTC(2026, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}
