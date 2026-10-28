import type {
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixPriceInput,
} from "./simulation-return-matrix-types.ts";

export type SimulationPeriodCandidateInput = Readonly<{
  displayName?: string | null;
  market: string | null;
  currency: string | null;
  ticker: string | null;
}>;

export type SimulationPeriodRequestInput = Readonly<{
  candidates: readonly SimulationPeriodCandidateInput[];
  endServiceDate: string;
  returnStepCount: number;
  priceRows: readonly SimulationReturnMatrixPriceInput[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}>;

export type SimulationPeriodCandidate = Readonly<{
  instrumentKey: string;
  displayName: string | null;
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
}>;

export type SimulationPeriodObservation = Readonly<{
  sourceDate: string;
  serviceDate: string;
}>;

export type SimulationPeriodIssueSeverity = "blocked" | "incomplete";

export type SimulationPeriodIssueReason =
  | "invalid_end_service_date"
  | "invalid_return_step_count"
  | "empty_candidate_universe"
  | "invalid_candidate_identity"
  | "unsupported_candidate_currency"
  | "duplicate_candidate"
  | "invalid_price_date"
  | "raw_close_field_forbidden"
  | "invalid_adjusted_close"
  | "duplicate_price_date"
  | "invalid_fx_date"
  | "invalid_fx_status"
  | "invalid_fx_rate"
  | "duplicate_fx_date"
  | "end_service_date_not_observed"
  | "insufficient_axis_points"
  | "missing_candidate_price"
  | "missing_fx_observation";

export type SimulationPeriodIssue = Readonly<{
  severity: SimulationPeriodIssueSeverity;
  reason: SimulationPeriodIssueReason;
  instrumentKey: string | null;
  dates: readonly string[];
}>;

export type SimulationPeriodCandidateAvailability = Readonly<{
  instrumentKey: string;
  displayName: string | null;
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
  status: "observed" | "missing";
  observationCount: number;
  firstServiceDate: string | null;
  lastServiceDate: string | null;
}>;

export type SimulationPeriodNormalizedPriceRows = Readonly<{
  observationsByInstrument: ReadonlyMap<
    string,
    readonly SimulationPeriodObservation[]
  >;
  axisDates: readonly string[];
  acceptedObservationCount: number;
  ignoredExternalRowCount: number;
  ignoredFutureRowCount: number;
  issues: readonly SimulationPeriodIssue[];
}>;

export type SimulationPeriodNormalizedFxRows = Readonly<{
  observations: readonly SimulationPeriodObservation[];
  axisDates: readonly string[];
  acceptedObservationCount: number;
  ignoredFutureRowCount: number;
  ignoredNotRequiredRowCount: number;
  issues: readonly SimulationPeriodIssue[];
}>;
