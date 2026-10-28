import { ADJUSTED_CLOSE_BASIS } from "./market-data/providers/types.ts";
import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";
import type { SimulationReturnMatrixResult } from "./simulation-return-matrix-types.ts";

export const SIMULATION_HISTORICAL_EVIDENCE_ADMISSION_POLICY = Object.freeze({
  version: "simulation_historical_evidence_admission_v1",
  instrumentIdentity: "market_currency_ticker",
  admittedAdjustedCloseBasis: ADJUSTED_CLOSE_BASIS.provider,
  providerBinding: "explicit_symbol_and_exchange_required",
  foreignReturnBasis: "date_specific_krw_investor_return",
  managedSleevePolicy: "excluded_by_policy",
  physicalCommodityPolicy: "manual_history_required",
  missingEvidencePolicy: "preserve_instrument_diagnostics",
  currentPortfolioLabel:
    "forbidden_when_positive_weight_modeled_instrument_is_incomplete",
} as const);

export type SimulationHistoricalEvidenceStatus =
  | "ready"
  | "price_history_incomplete"
  | "price_basis_ineligible"
  | "fx_incomplete"
  | "provider_binding_missing"
  | "excluded_by_policy"
  | "manual_history_required"
  | "blocked_invalid_input";

export type SimulationHistoricalEvidenceIssue =
  | "invalid_instrument_identity"
  | "provider_binding_missing"
  | "price_identity_mismatch"
  | "provider_binding_mismatch"
  | "adjusted_close_basis_ineligible"
  | "adjusted_close_source_missing"
  | "adjusted_close_fetched_at_invalid"
  | "price_history_incomplete"
  | "fx_incomplete"
  | "matrix_input_invalid";

export type SimulationHistoricalEvidencePriceInput = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  priceDate: string;
  adjustedClosePrice: number | string | null;
  adjustedCloseBasis: string | null;
  adjustedCloseProvider: string | null;
  adjustedCloseSource: string | null;
  adjustedCloseFetchedAt: string | Date | null;
  providerSymbol: string | null;
  providerExchange: string | null;
}>;

export type SimulationHistoricalEvidenceAdmission = Readonly<{
  policy: typeof SIMULATION_HISTORICAL_EVIDENCE_ADMISSION_POLICY;
  status: SimulationHistoricalEvidenceStatus;
  classification: PortfolioHoldingClassification;
  instrumentKey: string | null;
  issues: readonly SimulationHistoricalEvidenceIssue[];
  evidence: Readonly<{
    suppliedPriceRowCount: number;
    admittedPriceRowCount: number;
    ineligiblePriceRowCount: number;
    requestedServiceDateCount: number;
    readyCellCount: number;
    incompleteCellCount: number;
    coveragePct: number;
  }>;
  matrix: SimulationReturnMatrixResult | null;
}>;
