import { closeCalendarReferenceDateForAsset } from "../snapshots/market-calendar.ts";

export type FscKrxGoldMarketDateAvailability = Readonly<{
  marketDate: string;
  status:
    | "official_close_available"
    | "source_lag_not_published"
    | "non_trading_date_no_observation_expected"
    | "observation_before_publication_window"
    | "unexpected_non_trading_observation";
  isTradingDate: boolean;
  providerObservationPresent: boolean;
  expectedPublicationAt: string | null;
  observationAdmission: "admit" | "do_not_admit";
}>;

const KRX_MARKET = Object.freeze({ market: "korea", currency: "KRW" });

export function classifyFscKrxGoldMarketDateAvailability(input: Readonly<{
  marketDate: string;
  evaluatedAt: Date | string;
  providerObservationPresent: boolean;
}>): FscKrxGoldMarketDateAvailability {
  if (!isIsoDate(input.marketDate)) throw new Error("invalid_market_date");

  const evaluatedAt = toDate(input.evaluatedAt, "invalid_evaluation_time");
  const isTradingDate = isFscKrxGoldExpectedTradingDate(input.marketDate);

  if (!isTradingDate) {
    return availabilityResult({
      marketDate: input.marketDate,
      status: input.providerObservationPresent
        ? "unexpected_non_trading_observation"
        : "non_trading_date_no_observation_expected",
      isTradingDate,
      providerObservationPresent: input.providerObservationPresent,
      expectedPublicationAt: null,
      observationAdmission: "do_not_admit",
    });
  }

  const expectedPublicationAt = publicationAtForTradingDate(input.marketDate);
  if (evaluatedAt < expectedPublicationAt) {
    return availabilityResult({
      marketDate: input.marketDate,
      status: input.providerObservationPresent
        ? "observation_before_publication_window"
        : "source_lag_not_published",
      isTradingDate,
      providerObservationPresent: input.providerObservationPresent,
      expectedPublicationAt: expectedPublicationAt.toISOString(),
      observationAdmission: "do_not_admit",
    });
  }

  return availabilityResult({
    marketDate: input.marketDate,
    status: input.providerObservationPresent
      ? "official_close_available"
      : "source_lag_not_published",
    isTradingDate,
    providerObservationPresent: input.providerObservationPresent,
    expectedPublicationAt: expectedPublicationAt.toISOString(),
    observationAdmission: input.providerObservationPresent
      ? "admit"
      : "do_not_admit",
  });
}

export function resolveFscKrxGoldPublicationSafeEndDate(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("invalid_current_time");

  const kstDate = new Date(now.getTime() + 9 * 60 * 60 * 1_000)
    .toISOString()
    .slice(0, 10);
  let candidate = shiftIsoDate(kstDate, -1);

  for (let inspected = 0; inspected < 31; inspected += 1) {
    if (
      isFscKrxGoldExpectedTradingDate(candidate) &&
      now >= publicationAtForTradingDate(candidate)
    ) {
      return candidate;
    }
    candidate = shiftIsoDate(candidate, -1);
  }

  throw new Error("publication_safe_end_date_unresolved");
}

export function isFscKrxGoldExpectedTradingDate(date: string) {
  if (!isIsoDate(date)) return false;
  return (
    closeCalendarReferenceDateForAsset(KRX_MARKET, shiftIsoDate(date, 1)) ===
    date
  );
}

function publicationAtForTradingDate(marketDate: string) {
  return kstHourToUtc(nextKoreaTradingDate(marketDate), 13);
}

function nextKoreaTradingDate(date: string) {
  let candidate = shiftIsoDate(date, 1);
  for (let inspected = 0; inspected < 31; inspected += 1) {
    if (isFscKrxGoldExpectedTradingDate(candidate)) return candidate;
    candidate = shiftIsoDate(candidate, 1);
  }
  throw new Error("next_korea_trading_date_unresolved");
}

function kstHourToUtc(date: string, hour: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour - 9));
}

function isIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toISOString().slice(0, 10) === value;
}

function shiftIsoDate(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toDate(value: Date | string, error: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(error);
  return date;
}

function availabilityResult(
  value: FscKrxGoldMarketDateAvailability,
): FscKrxGoldMarketDateAvailability {
  return Object.freeze(value);
}
