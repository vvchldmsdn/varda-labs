export type SimulationNumericInput = number | string | null | undefined;

export type SimulationReturnMatrixStatus = "blocked" | "incomplete" | "ready";

export type SimulationInstrumentHistoryStatus =
  | "instrument_keyed"
  | "unavailable";

export type SimulationReturnMatrixInstrumentInput = Readonly<{
  market: string | null;
  currency: string | null;
  ticker: string | null;
  historyStatus: SimulationInstrumentHistoryStatus;
}>;

export type SimulationReturnMatrixPriceInput = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  priceDate: string;
  adjustedClosePrice: SimulationNumericInput;
  closePrice?: never;
  rawClosePrice?: never;
}>;

export type SimulationReturnMatrixFxInput = Readonly<{
  rateDate: string;
  usdKrw: SimulationNumericInput;
  status: string;
}>;

export type SimulationReturnMatrixInstrument = Readonly<{
  instrumentKey: string;
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
}>;

export type SimulationReturnMatrixExclusionReason =
  | "instrument_history_unavailable"
  | "invalid_market"
  | "missing_ticker"
  | "unsupported_currency";

export type SimulationReturnMatrixExclusion = Readonly<{
  market: string | null;
  currency: string | null;
  ticker: string | null;
  reason: SimulationReturnMatrixExclusionReason;
}>;

export type SimulationReturnMatrixBlockerReason =
  | "insufficient_service_dates"
  | "invalid_service_date"
  | "duplicate_service_date"
  | "unsorted_service_dates"
  | "duplicate_instrument"
  | "invalid_instrument_history_status"
  | "invalid_price_identity"
  | "invalid_price_date"
  | "duplicate_price_date"
  | "raw_close_field_forbidden"
  | "invalid_adjusted_close"
  | "invalid_fx_date"
  | "duplicate_fx_date"
  | "invalid_fx_rate"
  | "invalid_fx_status"
  | "invalid_return_value";

export type SimulationReturnMatrixBlocker = Readonly<{
  reason: SimulationReturnMatrixBlockerReason;
  instrumentKey: string | null;
  dates: readonly string[];
}>;

export type SimulationReturnMatrixMissingReason =
  | "missing_price"
  | "stale_price"
  | "missing_fx"
  | "stale_fx";

export type SimulationReturnMatrixCellEvidence = Readonly<{
  status: "ready" | "missing";
  reason: SimulationReturnMatrixMissingReason | null;
  sourcePriceDate: string | null;
  priceCarryDays: number | null;
  sourceFxDate: string | null;
  fxCarryDays: number | null;
}>;

export type SimulationReturnMatrixCell = Readonly<{
  instrumentKey: string;
  value: number | null;
  previous: SimulationReturnMatrixCellEvidence;
  current: SimulationReturnMatrixCellEvidence;
}>;

export type SimulationReturnMatrixRow = Readonly<{
  previousServiceDate: string;
  serviceDate: string;
  cells: readonly SimulationReturnMatrixCell[];
}>;

export type SimulationReturnMatrixSummary = Readonly<{
  requestedInstrumentCount: number;
  includedInstrumentCount: number;
  excludedInstrumentCount: number;
  requestedServiceDateCount: number;
  matrixRowCount: number;
  totalCellCount: number;
  readyCellCount: number;
  incompleteCellCount: number;
  coveragePct: number;
}>;

export type SimulationReturnMatrixSourceSummary = Readonly<{
  acceptedPriceRows: number;
  acceptedFxRows: number;
  ignoredOutOfWindowPriceRows: number;
  ignoredOutOfWindowFxRows: number;
}>;

export type SimulationReturnMatrixResult = Readonly<{
  status: SimulationReturnMatrixStatus;
  policy: Readonly<{
    version: "simulation_return_matrix_v1";
    returnKind: "krw_investor_simple_return";
    priceField: "adjusted_close_price_only";
    fxPolicy: "date_specific_usdkrw";
    serviceDatePolicy: "stored_close_evidence_d_plus_1";
    maxPriceCarryDays: 7;
    maxFxCarryDays: 3;
    missingCellPolicy: "preserve_null_without_row_drop_or_zero_fill";
    instrumentMinimum: "none";
    stochasticConsumer: "blocked_when_incomplete";
  }>;
  requestedServiceDates: readonly string[];
  instruments: readonly SimulationReturnMatrixInstrument[];
  exclusions: readonly SimulationReturnMatrixExclusion[];
  matrix: readonly SimulationReturnMatrixRow[];
  summary: SimulationReturnMatrixSummary;
  sourceSummary: SimulationReturnMatrixSourceSummary;
  consumerStatus: "matrix_ready" | "blocked_incomplete_matrix";
  blockers: readonly SimulationReturnMatrixBlocker[];
}>;

export type SimulationPriceObservation = Readonly<{
  sourceDate: string;
  serviceDate: string;
  adjustedClosePrice: number;
}>;

export type SimulationFxObservation = Readonly<{
  sourceDate: string;
  serviceDate: string;
  rate: number;
}>;

export type SimulationAlignedValue = Readonly<{
  evidence: SimulationReturnMatrixCellEvidence;
  unitValueKrw: number | null;
}>;
