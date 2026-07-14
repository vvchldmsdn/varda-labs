import type { PortfolioStructureExclusionReason } from "./portfolio-structure.ts";

export type InvestmentLabEtfXrayMasterInput = Readonly<{
  referenceId: string;
  ticker: string;
  name: string;
  market: string;
  currency: string;
}>;

export type InvestmentLabEtfXrayStatus =
  | "complete_common_date"
  | "complete_mixed_dates"
  | "partial"
  | "unavailable";

export type InvestmentLabEtfXrayEtfRow = Readonly<{
  name: string;
  ticker: string | null;
  accounts: readonly string[];
  market: string;
  currency: string;
  currentValueKrw: number;
  valuedSubsetWeightPct: number;
  mappingStatus:
    | "matched"
    | "missing_reference"
    | "ambiguous_reference";
  evidenceStatus:
    | "complete"
    | "partial"
    | "missing"
    | "invalid_weight_total";
  asOfDate: string | null;
  rawRowCount: number;
  componentCount: number;
  duplicateGroupCount: number;
  unmappedComponentCount: number;
  missingWeightCount: number;
  observedWeightPct: number | null;
  uncoveredWeightPct: number;
}>;

export type InvestmentLabEtfXrayComponentRow = Readonly<{
  name: string;
  symbol: string;
  market: string;
  currency: string;
  valuedSubsetExposurePct: number;
  directValuedSubsetWeightPct: number;
  throughEtfCount: number;
  throughEtfs: readonly string[];
  asOfDates: readonly string[];
  hasDirectOverlap: boolean;
  hasMultiEtfOverlap: boolean;
}>;

export type InvestmentLabEtfXrayModel = Readonly<{
  status: InvestmentLabEtfXrayStatus;
  summary: Readonly<{
    basePortfolioCoverageStatus: "complete" | "partial";
    exposureScope: "whole_portfolio" | "valued_subset";
    valuedHoldingCount: number;
    excludedHoldingCount: number;
    excludedEtfHoldingCount: number;
    exclusionReasonCounts: Readonly<
      Record<PortfolioStructureExclusionReason, number>
    >;
    valuedEtfCount: number;
    matchedValuedEtfCount: number;
    missingReferenceValuedEtfCount: number;
    ambiguousReferenceValuedEtfCount: number;
    evidenceAvailableEtfCount: number;
    completeEvidenceEtfCount: number;
    valuedSubsetEtfWeightPct: number;
    observedValuedSubsetExposurePct: number;
    uncoveredValuedSubsetExposurePct: number;
    componentCount: number;
    overlapCount: number;
    directOverlapCount: number;
    multiEtfOverlapCount: number;
    asOfDates: readonly string[];
    mixedAsOfDates: boolean;
  }>;
  etfRows: readonly InvestmentLabEtfXrayEtfRow[];
  componentRows: readonly InvestmentLabEtfXrayComponentRow[];
}>;
