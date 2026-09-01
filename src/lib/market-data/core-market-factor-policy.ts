export const CORE_MARKET_FACTOR_DEFINITIONS = Object.freeze([
  Object.freeze({
    factorKey: "usdkrw",
    factorFamily: "fx",
    factorName: "USD/KRW 환율",
    source: "Frankfurter",
    sourceSeriesId: "FRANKFURTER_USD_KRW",
    countryCode: "KR",
    region: "korea",
    relatedCurrency: "KRW",
    tenor: "spot",
    transform: "log_return_pct",
  }),
  Object.freeze({
    factorKey: "us_10y_yield",
    factorFamily: "sovereign_yield",
    factorName: "미국 10년 국채금리",
    source: "FRED",
    sourceSeriesId: "DGS10",
    countryCode: "US",
    region: "us",
    relatedCurrency: "USD",
    tenor: "10y",
    transform: "percentage_point_change",
  }),
  Object.freeze({
    factorKey: "us_10y2y_curve",
    factorFamily: "yield_curve",
    factorName: "미국 장단기 금리차",
    source: "FRED",
    sourceSeriesId: "T10Y2Y",
    countryCode: "US",
    region: "us",
    relatedCurrency: "USD",
    tenor: "10y-2y",
    transform: "percentage_point_change",
  }),
] as const);

export const CORE_MARKET_FACTOR_REFRESH_POLICY = Object.freeze({
  version: "core_market_factor_refresh_v1",
  frequency: "daily",
  sourceLookbackCalendarDays: 400,
  emptySeriesBackfillCalendarDays: 365,
  releaseDatePolicy:
    "observation_date_with_strict_next_service_date_admission",
  vintagePolicy: "latest_provider_value_only_revision_history_not_preserved",
  writeMode: "insert_missing_factor_key_date_only",
  requiredSeries: Object.freeze(
    CORE_MARKET_FACTOR_DEFINITIONS.map((row) => row.sourceSeriesId),
  ),
} as const);

export type CoreMarketFactorDefinition =
  (typeof CORE_MARKET_FACTOR_DEFINITIONS)[number];

export type CoreMarketFactorObservation = Readonly<{
  date: string;
  value: number;
}>;
