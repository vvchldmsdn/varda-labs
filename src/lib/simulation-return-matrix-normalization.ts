import {
  isRiskDate,
  latestRiskObservationOnOrBefore,
  mapRiskEvidenceDateToServiceDate,
  shiftRiskDate,
} from "./portfolio-risk-calendar.ts";
import type {
  SimulationAlignedValue,
  SimulationFxObservation,
  SimulationPriceObservation,
  SimulationReturnMatrixBlocker,
  SimulationReturnMatrixBlockerReason,
  SimulationReturnMatrixCellEvidence,
  SimulationReturnMatrixExclusion,
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixInstrument,
  SimulationReturnMatrixInstrumentInput,
  SimulationReturnMatrixPriceInput,
} from "./simulation-return-matrix-types.ts";

export function normalizeSimulationInstrumentUniverse(
  rows: readonly SimulationReturnMatrixInstrumentInput[],
) {
  const instruments: SimulationReturnMatrixInstrument[] = [];
  const exclusions: SimulationReturnMatrixExclusion[] = [];
  const blockers: SimulationReturnMatrixBlocker[] = [];
  const counts = new Map<string, number>();

  for (const sourceRow of rows) {
    const row = sourceRow as SimulationReturnMatrixInstrumentInput;
    const market = normalizeMarket(row?.market);
    const currency = normalizeCurrency(row?.currency);
    const ticker = normalizeTicker(row?.ticker);

    if (
      row?.historyStatus !== "instrument_keyed" &&
      row?.historyStatus !== "unavailable"
    ) {
      addBlocker(blockers, "invalid_instrument_history_status");
      continue;
    }
    if (row.historyStatus === "unavailable") {
      exclusions.push({
        market,
        currency,
        ticker,
        reason: "instrument_history_unavailable",
      });
      continue;
    }
    if (!market) {
      exclusions.push({ market, currency, ticker, reason: "invalid_market" });
      continue;
    }
    if (!ticker) {
      exclusions.push({ market, currency, ticker, reason: "missing_ticker" });
      continue;
    }
    if (currency !== "KRW" && currency !== "USD") {
      exclusions.push({
        market,
        currency,
        ticker,
        reason: "unsupported_currency",
      });
      continue;
    }

    const instrumentKey = simulationInstrumentKey(market, currency, ticker);
    counts.set(instrumentKey, (counts.get(instrumentKey) ?? 0) + 1);
    instruments.push({ instrumentKey, market, currency, ticker });
  }

  for (const [instrumentKey, count] of counts) {
    if (count > 1) {
      addBlocker(blockers, "duplicate_instrument", instrumentKey);
    }
  }

  return {
    instruments: Object.freeze(
      instruments
        .filter((row) => counts.get(row.instrumentKey) === 1)
        .sort((left, right) =>
          left.instrumentKey.localeCompare(right.instrumentKey),
        )
        .map((row) => Object.freeze(row)),
    ),
    exclusions: Object.freeze(
      exclusions.sort(compareExclusions).map((row) => Object.freeze(row)),
    ),
    blockers: sortSimulationBlockers(blockers),
  };
}

export function validateSimulationServiceDates(values: readonly string[]) {
  const blockers: SimulationReturnMatrixBlocker[] = [];
  const dates = Array.isArray(values) ? values.map((value) => String(value)) : [];

  if (dates.length < 2) {
    addBlocker(blockers, "insufficient_service_dates");
  }
  const invalidDates = dates.filter((date) => !isRiskDate(date));
  if (invalidDates.length > 0) {
    addBlocker(blockers, "invalid_service_date", null, invalidDates);
  }
  const duplicateDates = dates.filter(
    (date, index) => dates.indexOf(date) !== index,
  );
  if (duplicateDates.length > 0) {
    addBlocker(blockers, "duplicate_service_date", null, duplicateDates);
  }
  if (
    dates.some(
      (date, index) => index > 0 && dates[index - 1].localeCompare(date) > 0,
    )
  ) {
    addBlocker(blockers, "unsorted_service_dates");
  }

  return {
    dates: Object.freeze([...dates]),
    blockers: sortSimulationBlockers(blockers),
  };
}

export function normalizeSimulationPriceRows({
  rows,
  instruments,
  serviceDates,
  maxCarryDays,
}: {
  rows: readonly SimulationReturnMatrixPriceInput[];
  instruments: readonly SimulationReturnMatrixInstrument[];
  serviceDates: readonly string[];
  maxCarryDays: number;
}) {
  const blockers: SimulationReturnMatrixBlocker[] = [];
  const seriesByInstrument = new Map<string, SimulationPriceObservation[]>();
  const instrumentKeys = new Set(instruments.map((row) => row.instrumentKey));
  const firstServiceDate = serviceDates[0];
  const lastServiceDate = serviceDates.at(-1);
  const scanStart = firstServiceDate
    ? shiftRiskDate(firstServiceDate, -maxCarryDays)
    : null;
  const groups = new Map<
    string,
    Array<{ instrumentKey: string; observation: SimulationPriceObservation }>
  >();
  let ignoredOutOfWindowRows = 0;

  for (const sourceRow of rows) {
    const row = sourceRow as SimulationReturnMatrixPriceInput &
      Record<string, unknown>;
    const market = normalizeMarket(row?.market);
    const currency = normalizeCurrency(row?.currency);
    const ticker = normalizeTicker(row?.ticker);
    if (!market || !ticker || (currency !== "KRW" && currency !== "USD")) {
      addBlocker(blockers, "invalid_price_identity");
      continue;
    }
    const instrumentKey = simulationInstrumentKey(market, currency, ticker);
    if (!instrumentKeys.has(instrumentKey)) continue;
    if (!isRiskDate(row.priceDate)) {
      addBlocker(blockers, "invalid_price_date", instrumentKey);
      continue;
    }
    const serviceDate = mapRiskEvidenceDateToServiceDate(row.priceDate);
    if (
      !scanStart ||
      !lastServiceDate ||
      serviceDate < scanStart ||
      serviceDate > lastServiceDate
    ) {
      ignoredOutOfWindowRows += 1;
      continue;
    }
    if (
      Object.prototype.hasOwnProperty.call(row, "closePrice") ||
      Object.prototype.hasOwnProperty.call(row, "rawClosePrice")
    ) {
      addBlocker(
        blockers,
        "raw_close_field_forbidden",
        instrumentKey,
        [row.priceDate],
      );
    }
    const adjustedClosePrice = positiveNumber(row.adjustedClosePrice);
    if (adjustedClosePrice === null) {
      addBlocker(
        blockers,
        "invalid_adjusted_close",
        instrumentKey,
        [row.priceDate],
      );
      continue;
    }
    const groupKey = `${instrumentKey}|${row.priceDate}`;
    const group = groups.get(groupKey) ?? [];
    group.push({
      instrumentKey,
      observation: {
        sourceDate: row.priceDate,
        serviceDate,
        adjustedClosePrice,
      },
    });
    groups.set(groupKey, group);
  }

  let acceptedRows = 0;
  for (const group of groups.values()) {
    const first = group[0];
    if (group.length > 1) {
      addBlocker(
        blockers,
        "duplicate_price_date",
        first.instrumentKey,
        [first.observation.sourceDate],
      );
      continue;
    }
    const series = seriesByInstrument.get(first.instrumentKey) ?? [];
    series.push(first.observation);
    seriesByInstrument.set(first.instrumentKey, series);
    acceptedRows += 1;
  }
  for (const series of seriesByInstrument.values()) {
    series.sort((left, right) =>
      left.serviceDate.localeCompare(right.serviceDate),
    );
  }

  return {
    seriesByInstrument,
    acceptedRows,
    ignoredOutOfWindowRows,
    blockers: sortSimulationBlockers(blockers),
  };
}

export function normalizeSimulationFxRows({
  rows,
  required,
  serviceDates,
  maxCarryDays,
}: {
  rows: readonly SimulationReturnMatrixFxInput[];
  required: boolean;
  serviceDates: readonly string[];
  maxCarryDays: number;
}) {
  if (!required) {
    return {
      series: Object.freeze([] as SimulationFxObservation[]),
      acceptedRows: 0,
      ignoredOutOfWindowRows: 0,
      blockers: Object.freeze([] as SimulationReturnMatrixBlocker[]),
    };
  }

  const blockers: SimulationReturnMatrixBlocker[] = [];
  const firstServiceDate = serviceDates[0];
  const lastServiceDate = serviceDates.at(-1);
  const scanStart = firstServiceDate
    ? shiftRiskDate(firstServiceDate, -maxCarryDays)
    : null;
  const groups = new Map<string, SimulationReturnMatrixFxInput[]>();
  let ignoredOutOfWindowRows = 0;

  for (const row of rows) {
    if (!isRiskDate(row.rateDate)) {
      addBlocker(blockers, "invalid_fx_date");
      continue;
    }
    const serviceDate = mapRiskEvidenceDateToServiceDate(row.rateDate);
    if (
      !scanStart ||
      !lastServiceDate ||
      serviceDate < scanStart ||
      serviceDate > lastServiceDate
    ) {
      ignoredOutOfWindowRows += 1;
      continue;
    }
    const group = groups.get(row.rateDate) ?? [];
    group.push(row);
    groups.set(row.rateDate, group);
  }

  const series: SimulationFxObservation[] = [];
  for (const [rateDate, group] of groups) {
    if (group.length > 1) {
      addBlocker(blockers, "duplicate_fx_date", null, [rateDate]);
      continue;
    }
    const row = group[0];
    if (String(row.status ?? "").trim().toLowerCase() !== "ok") {
      addBlocker(blockers, "invalid_fx_status", null, [rateDate]);
      continue;
    }
    const rate = positiveNumber(row.usdKrw);
    if (rate === null) {
      addBlocker(blockers, "invalid_fx_rate", null, [rateDate]);
      continue;
    }
    series.push({
      sourceDate: rateDate,
      serviceDate: mapRiskEvidenceDateToServiceDate(rateDate),
      rate,
    });
  }
  series.sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
  );

  return {
    series: Object.freeze(series.map((row) => Object.freeze(row))),
    acceptedRows: series.length,
    ignoredOutOfWindowRows,
    blockers: sortSimulationBlockers(blockers),
  };
}

export function alignSimulationValue({
  serviceDate,
  instrument,
  priceSeries,
  fxSeries,
  maxPriceCarryDays,
  maxFxCarryDays,
}: {
  serviceDate: string;
  instrument: SimulationReturnMatrixInstrument;
  priceSeries: readonly SimulationPriceObservation[];
  fxSeries: readonly SimulationFxObservation[];
  maxPriceCarryDays: number;
  maxFxCarryDays: number;
}): SimulationAlignedValue {
  const price = latestRiskObservationOnOrBefore(priceSeries, serviceDate);
  if (!price) return missingAlignedValue("missing_price");
  if (price.carryDays > maxPriceCarryDays) {
    return missingAlignedValue(
      "stale_price",
      price.row.sourceDate,
      price.carryDays,
    );
  }

  const fx =
    instrument.currency === "USD"
      ? latestRiskObservationOnOrBefore(fxSeries, serviceDate)
      : null;
  if (instrument.currency === "USD" && !fx) {
    return missingAlignedValue(
      "missing_fx",
      price.row.sourceDate,
      price.carryDays,
    );
  }
  if (instrument.currency === "USD" && fx && fx.carryDays > maxFxCarryDays) {
    return missingAlignedValue(
      "stale_fx",
      price.row.sourceDate,
      price.carryDays,
      fx.row.sourceDate,
      fx.carryDays,
    );
  }

  const unitValueKrw =
    price.row.adjustedClosePrice * (fx?.row.rate ?? 1);
  return {
    evidence: Object.freeze({
      status: "ready",
      reason: null,
      sourcePriceDate: price.row.sourceDate,
      priceCarryDays: price.carryDays,
      sourceFxDate: fx?.row.sourceDate ?? null,
      fxCarryDays: fx?.carryDays ?? null,
    }),
    unitValueKrw:
      Number.isFinite(unitValueKrw) && unitValueKrw > 0
        ? unitValueKrw
        : null,
  };
}

export function sortSimulationBlockers(
  blockers: readonly SimulationReturnMatrixBlocker[],
) {
  const unique = new Map(
    blockers.map((row) => [JSON.stringify(row), row] as const),
  );
  return Object.freeze(
    [...unique.values()]
      .sort(
        (left, right) =>
          left.reason.localeCompare(right.reason) ||
          String(left.instrumentKey).localeCompare(String(right.instrumentKey)) ||
          left.dates.join(",").localeCompare(right.dates.join(",")),
      )
      .map((row) => Object.freeze(row)),
  );
}

function missingAlignedValue(
  reason: SimulationReturnMatrixCellEvidence["reason"],
  sourcePriceDate: string | null = null,
  priceCarryDays: number | null = null,
  sourceFxDate: string | null = null,
  fxCarryDays: number | null = null,
): SimulationAlignedValue {
  return {
    evidence: Object.freeze({
      status: "missing",
      reason,
      sourcePriceDate,
      priceCarryDays,
      sourceFxDate,
      fxCarryDays,
    }),
    unitValueKrw: null,
  };
}

function addBlocker(
  blockers: SimulationReturnMatrixBlocker[],
  reason: SimulationReturnMatrixBlockerReason,
  instrumentKey: string | null = null,
  dates: readonly string[] = [],
) {
  blockers.push({
    reason,
    instrumentKey,
    dates: Object.freeze([...new Set(dates)].sort()),
  });
}

function compareExclusions(
  left: SimulationReturnMatrixExclusion,
  right: SimulationReturnMatrixExclusion,
) {
  return (
    left.reason.localeCompare(right.reason) ||
    String(left.market).localeCompare(String(right.market)) ||
    String(left.currency).localeCompare(String(right.currency)) ||
    String(left.ticker).localeCompare(String(right.ticker))
  );
}

function simulationInstrumentKey(
  market: string,
  currency: "KRW" | "USD",
  ticker: string,
) {
  return `${market}|${currency}|${ticker}`;
}

function normalizeMarket(value: unknown) {
  const market = String(value ?? "").trim().toLowerCase();
  return market || null;
}

function normalizeCurrency(value: unknown) {
  const currency = String(value ?? "").trim().toUpperCase();
  return currency || null;
}

function normalizeTicker(value: unknown) {
  const ticker = String(value ?? "").trim().toUpperCase();
  return ticker || null;
}

function positiveNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
