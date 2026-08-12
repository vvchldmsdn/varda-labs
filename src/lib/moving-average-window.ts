export type MovingAverageWindowBlocker =
  | "invalid_price_date"
  | "duplicate_price_date"
  | "fewer_than_required_observations"
  | "invalid_average_calculation";

type ValidObservation = Readonly<{
  priceDate: string;
  price: number;
}>;

export function evaluateMovingAverageWindow<TBlocker extends string>({
  asOfPriceDate,
  comparisonPrice,
  observations,
  windowObservationCount,
  initialBlockers,
  invalidPriceBlocker,
}: {
  asOfPriceDate: string;
  comparisonPrice: number;
  observations: readonly Readonly<{
    priceDate: unknown;
    price: unknown;
  }>[];
  windowObservationCount: number;
  initialBlockers: ReadonlySet<TBlocker>;
  invalidPriceBlocker: TBlocker;
}) {
  const blockers = new Set<TBlocker | MovingAverageWindowBlocker>(
    initialBlockers,
  );
  const validObservations: ValidObservation[] = [];
  let ignoredFutureObservationCount = 0;

  for (const row of observations) {
    const priceDate = normalizeMovingAveragePriceDate(row?.priceDate);
    if (!priceDate) {
      blockers.add("invalid_price_date");
      continue;
    }
    if (priceDate.localeCompare(asOfPriceDate) > 0) {
      ignoredFutureObservationCount += 1;
      continue;
    }
    const price = normalizeMovingAveragePositiveNumber(row?.price);
    if (price === null) {
      blockers.add(invalidPriceBlocker);
      continue;
    }
    validObservations.push(Object.freeze({ priceDate, price }));
  }

  const dateCounts = new Map<string, number>();
  for (const row of validObservations) {
    dateCounts.set(row.priceDate, (dateCounts.get(row.priceDate) ?? 0) + 1);
  }
  if ([...dateCounts.values()].some((count) => count > 1)) {
    blockers.add("duplicate_price_date");
  }

  if (blockers.size > 0) {
    return emptyResult({
      status: "invalid_history",
      availableObservationCount: validObservations.length,
      ignoredFutureObservationCount,
      blockers,
    });
  }

  validObservations.sort((left, right) =>
    left.priceDate.localeCompare(right.priceDate),
  );
  if (validObservations.length < windowObservationCount) {
    blockers.add("fewer_than_required_observations");
    return emptyResult({
      status: "insufficient_history",
      availableObservationCount: validObservations.length,
      ignoredFutureObservationCount,
      blockers,
    });
  }

  const window = validObservations.slice(-windowObservationCount);
  const movingAverage = incrementalMean(window);
  const distanceFromAveragePct =
    (comparisonPrice / movingAverage - 1) * 100;
  if (
    !Number.isFinite(movingAverage) ||
    movingAverage <= 0 ||
    !Number.isFinite(distanceFromAveragePct)
  ) {
    blockers.add("invalid_average_calculation");
    return emptyResult({
      status: "invalid_history",
      availableObservationCount: validObservations.length,
      ignoredFutureObservationCount,
      blockers,
    });
  }

  return Object.freeze({
    status: classifyComparison(comparisonPrice, movingAverage),
    availableObservationCount: validObservations.length,
    usedObservationCount: window.length,
    ignoredFutureObservationCount,
    oldestWindowPriceDate: window[0]?.priceDate ?? null,
    latestWindowPriceDate: window.at(-1)?.priceDate ?? null,
    movingAverage,
    distanceFromAveragePct,
    blockers,
  });
}

export function normalizeMovingAverageInstrumentKey(value: string) {
  const normalized = String(value ?? "").trim();
  return normalized &&
    /^[a-z0-9._-]+:[A-Z0-9._-]+:[A-Z0-9._-]+$/.test(normalized)
    ? normalized
    : null;
}

export function normalizeMovingAveragePositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

export function normalizeMovingAveragePriceDate(value: unknown) {
  const priceDate = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(priceDate)) return null;
  const [year, month, day] = priceDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? priceDate
    : null;
}

function emptyResult<TBlocker extends string>({
  status,
  availableObservationCount,
  ignoredFutureObservationCount,
  blockers,
}: {
  status: "invalid_history" | "insufficient_history";
  availableObservationCount: number;
  ignoredFutureObservationCount: number;
  blockers: ReadonlySet<TBlocker>;
}) {
  return Object.freeze({
    status,
    availableObservationCount,
    usedObservationCount: 0,
    ignoredFutureObservationCount,
    oldestWindowPriceDate: null,
    latestWindowPriceDate: null,
    movingAverage: null,
    distanceFromAveragePct: null,
    blockers,
  });
}

function classifyComparison(
  comparisonPrice: number,
  movingAverage: number,
): "above_ma" | "at_ma" | "below_ma" {
  const difference = comparisonPrice - movingAverage;
  const tolerance =
    Math.max(1, Math.abs(movingAverage)) * Number.EPSILON * 16;
  if (difference > tolerance) return "above_ma";
  if (difference < -tolerance) return "below_ma";
  return "at_ma";
}

function incrementalMean(rows: readonly ValidObservation[]) {
  let mean = 0;
  for (let index = 0; index < rows.length; index += 1) {
    mean += (rows[index].price - mean) / (index + 1);
  }
  return mean;
}
