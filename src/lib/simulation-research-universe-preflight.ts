import type { loadSimulationPeriodPreflight } from "./simulation-period-preflight-loader.ts";
import {
  admitSimulationHistoricalEvidence,
  type SimulationHistoricalEvidencePriceInput,
  type SimulationHistoricalEvidenceStatus,
} from "./simulation-historical-evidence-admission.ts";
import type { SimulationReturnMatrixFxInput } from "./simulation-return-matrix-types.ts";
import { ADJUSTED_CLOSE_BASIS } from "./market-data/providers/types.ts";
import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";
import {
  SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY,
  type SimulationResearchUniverseInstrument,
  type SimulationResearchUniverseSelection,
} from "./simulation-research-universe-preflight-policy.ts";
import { resolveSimulationResearchUniverseSelection } from "./simulation-research-universe-selection.ts";

export {
  SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY,
  resolveSimulationResearchUniverseSelection,
};
export type {
  SimulationResearchUniverseInstrument,
  SimulationResearchUniverseSelection,
  SimulationResearchUniverseSelectionIssue,
} from "./simulation-research-universe-preflight-policy.ts";

export type SimulationResearchUniversePriceRow =
  SimulationHistoricalEvidencePriceInput;

type SimulationPeriodPreflight = Awaited<
  ReturnType<typeof loadSimulationPeriodPreflight>
>;

export type SimulationResearchUniversePreflightModel = ReturnType<
  typeof buildSimulationResearchUniversePreflight
>;

export function buildSimulationResearchUniversePreflight(input: {
  selection: SimulationResearchUniverseSelection;
  requestedEndServiceDate: string | null;
  preflight: SimulationPeriodPreflight | null;
  priceRows: readonly SimulationResearchUniversePriceRow[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}) {
  const selection = input.selection;
  if (selection.status !== "valid") {
    return Object.freeze({
      policy: SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY,
      selectionStatus: selection.status,
      status:
        selection.status === "not_requested"
          ? ("not_requested" as const)
          : ("blocked_invalid_request" as const),
      runtimeTrustStatus: "not_established" as const,
      requestedEndServiceDate: input.requestedEndServiceDate,
      rawValue: selection.rawValue,
      issues: selection.issues,
      summary: Object.freeze({
        rowCount: selection.instruments.length,
        totalWeightBps: selection.totalWeightBps,
        storedEvidenceReadyWeightBps: 0,
        provenanceReadyWeightBps: 0,
        excludedWeightBps: 0,
        manualHistoryRequiredWeightBps: 0,
        incompleteWeightBps: selection.totalWeightBps,
      }),
      instruments: Object.freeze([]),
    });
  }

  const matrixByInstrument = new Map(
    (input.preflight?.matrixEvidence?.instruments ?? []).map((row) => [
      row.instrumentKey,
      row,
    ]),
  );
  const requestedServiceDates =
    input.preflight?.axis.resolvedServiceDates ?? [];
  const instruments = selection.instruments.map((instrument) => {
    if (instrument.weightBps === 0) {
      return terminalInstrument(instrument, "zero_weight_not_evaluated");
    }
    if (instrument.classification === "managed_sleeve") {
      return terminalInstrument(instrument, "excluded_by_policy");
    }
    if (instrument.classification === "physical_commodity_position") {
      return terminalInstrument(instrument, "manual_history_required");
    }
    if (instrument.classification === "unresolved") {
      return terminalInstrument(instrument, "identity_unresolved");
    }

    const priceRows = input.priceRows.filter((row) =>
      matchesInstrument(row, instrument),
    );
    const provenance = summarizeProvenance(priceRows);
    const matrixEvidence = matrixByInstrument.get(instrument.instrumentKey);
    const admission = buildQualifiedAdmission({
      instrument,
      requestedServiceDates,
      priceRows,
      fxRows: input.fxRows,
      provenance,
    });
    const status =
      matrixEvidence?.status !== "ready"
        ? ("stored_coverage_incomplete" as const)
        : admission?.status === "ready"
          ? ("provenance_ready_for_separate_review" as const)
          : ("provenance_incomplete" as const);

    return Object.freeze({
      ...instrument,
      status,
      storedCoverage: matrixEvidence
        ? Object.freeze({
            status: matrixEvidence.status,
            priceCoverage: matrixEvidence.priceCoverage,
            fxCoverage: matrixEvidence.fxCoverage,
            returnCoverage: matrixEvidence.returnCoverage,
            reasons: matrixEvidence.reasons,
          })
        : null,
      provenance,
      admissionStatus: admission?.status ?? null,
      admissionIssues: admission?.issues ?? Object.freeze([]),
    });
  });

  const summary = summarizeWeights(instruments);
  const positiveModeledRows = instruments.filter(
    (row) =>
      row.weightBps > 0 &&
      row.classification === "listed_instrument",
  );
  const status =
    positiveModeledRows.length === 0
      ? ("diagnostics_only" as const)
      : positiveModeledRows.every(
            (row) =>
              row.status ===
              "provenance_ready_for_separate_review",
          ) && summary.manualHistoryRequiredWeightBps === 0
        ? ("stored_evidence_ready_for_separate_review" as const)
        : ("partial_diagnostics_only" as const);

  return Object.freeze({
    policy: SIMULATION_RESEARCH_UNIVERSE_PREFLIGHT_POLICY,
    selectionStatus: selection.status,
    status,
    runtimeTrustStatus: "not_established" as const,
    requestedEndServiceDate: input.requestedEndServiceDate,
    rawValue: selection.rawValue,
    issues: selection.issues,
    summary,
    instruments: Object.freeze(instruments),
  });
}

function terminalInstrument(
  instrument: SimulationResearchUniverseInstrument,
  status:
    | "zero_weight_not_evaluated"
    | "excluded_by_policy"
    | "manual_history_required"
    | "identity_unresolved",
) {
  return Object.freeze({
    ...instrument,
    status,
    storedCoverage: null,
    provenance: emptyProvenance(),
    admissionStatus:
      status === "excluded_by_policy" ||
      status === "manual_history_required"
        ? (status as SimulationHistoricalEvidenceStatus)
        : null,
    admissionIssues: Object.freeze([]),
  });
}

function summarizeProvenance(
  rows: readonly SimulationResearchUniversePriceRow[],
) {
  const adjustedRows = rows.filter(
    (row) => row.adjustedClosePrice !== null,
  );
  const qualifiedRows = adjustedRows.filter(isQualifiedProvenanceRow);
  const bindings = uniqueSorted(
    qualifiedRows.map((row) =>
      [
        normalizeText(row.adjustedCloseProvider)?.toLowerCase(),
        normalizeText(row.providerSymbol)?.toUpperCase(),
        normalizeText(row.providerExchange)?.toUpperCase(),
      ].join("|"),
    ),
  );

  return Object.freeze({
    status:
      rows.length === 0
        ? ("missing" as const)
        : qualifiedRows.length === 0
          ? ("incomplete" as const)
          : bindings.length > 1
            ? ("ambiguous_binding" as const)
            : qualifiedRows.length < adjustedRows.length
              ? ("partial" as const)
              : ("complete" as const),
    storedRowCount: rows.length,
    adjustedCloseRowCount: adjustedRows.length,
    qualifiedRowCount: qualifiedRows.length,
    sourceDateFrom: adjustedRows[0]?.priceDate ?? null,
    sourceDateTo: adjustedRows.at(-1)?.priceDate ?? null,
    adjustedCloseBases: Object.freeze(
      uniqueSorted(
        adjustedRows.map((row) => normalizeText(row.adjustedCloseBasis)),
      ),
    ),
    providers: Object.freeze(
      uniqueSorted(
        qualifiedRows.map((row) =>
          normalizeText(row.adjustedCloseProvider)?.toLowerCase(),
        ),
      ),
    ),
    sources: Object.freeze(
      uniqueSorted(
        qualifiedRows.map((row) => normalizeText(row.adjustedCloseSource)),
      ),
    ),
    providerSymbols: Object.freeze(
      uniqueSorted(
        qualifiedRows.map((row) =>
          normalizeText(row.providerSymbol)?.toUpperCase(),
        ),
      ),
    ),
    providerExchanges: Object.freeze(
      uniqueSorted(
        qualifiedRows.map((row) =>
          normalizeText(row.providerExchange)?.toUpperCase(),
        ),
      ),
    ),
    bindingCount: bindings.length,
  });
}

function emptyProvenance() {
  return Object.freeze({
    status: "not_applicable" as const,
    storedRowCount: 0,
    adjustedCloseRowCount: 0,
    qualifiedRowCount: 0,
    sourceDateFrom: null,
    sourceDateTo: null,
    adjustedCloseBases: Object.freeze([] as string[]),
    providers: Object.freeze([] as string[]),
    sources: Object.freeze([] as string[]),
    providerSymbols: Object.freeze([] as string[]),
    providerExchanges: Object.freeze([] as string[]),
    bindingCount: 0,
  });
}

function buildQualifiedAdmission(input: {
  instrument: SimulationResearchUniverseInstrument;
  requestedServiceDates: readonly string[];
  priceRows: readonly SimulationResearchUniversePriceRow[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
  provenance: ReturnType<typeof summarizeProvenance>;
}) {
  if (
    input.requestedServiceDates.length === 0 ||
    input.provenance.bindingCount !== 1
  ) {
    return null;
  }

  const qualifiedRows = input.priceRows.filter(isQualifiedProvenanceRow);
  const first = qualifiedRows[0];
  if (!first) return null;

  return admitSimulationHistoricalEvidence({
    classification: "listed_instrument",
    instrument: input.instrument,
    providerBinding: {
      provider: first.adjustedCloseProvider,
      symbol: first.providerSymbol,
      exchange: first.providerExchange,
    },
    requestedServiceDates: input.requestedServiceDates,
    priceRows: qualifiedRows,
    fxRows: input.fxRows,
  });
}

function isQualifiedProvenanceRow(
  row: SimulationResearchUniversePriceRow,
) {
  return (
    row.adjustedClosePrice !== null &&
    row.adjustedCloseBasis === ADJUSTED_CLOSE_BASIS.provider &&
    Boolean(normalizeText(row.adjustedCloseProvider)) &&
    Boolean(normalizeText(row.adjustedCloseSource)) &&
    Boolean(normalizeText(row.providerSymbol)) &&
    Boolean(normalizeText(row.providerExchange)) &&
    isValidTimestamp(row.adjustedCloseFetchedAt)
  );
}

function matchesInstrument(
  row: SimulationResearchUniversePriceRow,
  instrument: SimulationResearchUniverseInstrument,
) {
  return (
    row.market.trim().toLowerCase() === instrument.market &&
    row.currency.trim().toUpperCase() === instrument.currency &&
    row.ticker.trim().toUpperCase() === instrument.ticker
  );
}

function summarizeWeights(
  rows: readonly Readonly<{
    weightBps: number;
    classification: PortfolioHoldingClassification;
    status:
      | "zero_weight_not_evaluated"
      | "excluded_by_policy"
      | "manual_history_required"
      | "identity_unresolved"
      | "stored_coverage_incomplete"
      | "provenance_incomplete"
      | "provenance_ready_for_separate_review";
    storedCoverage: Readonly<{ status: string }> | null;
  }>[],
) {
  let storedEvidenceReadyWeightBps = 0;
  let provenanceReadyWeightBps = 0;
  let excludedWeightBps = 0;
  let manualHistoryRequiredWeightBps = 0;
  let incompleteWeightBps = 0;

  for (const row of rows) {
    if (row.status === "excluded_by_policy") {
      excludedWeightBps += row.weightBps;
    } else if (row.status === "manual_history_required") {
      manualHistoryRequiredWeightBps += row.weightBps;
      incompleteWeightBps += row.weightBps;
    } else if (row.status === "provenance_ready_for_separate_review") {
      storedEvidenceReadyWeightBps += row.weightBps;
      provenanceReadyWeightBps += row.weightBps;
    } else if (row.status !== "zero_weight_not_evaluated") {
      const storedCoverage = row.storedCoverage as
        | { status?: string }
        | null;
      if (storedCoverage?.status === "ready") {
        storedEvidenceReadyWeightBps += row.weightBps;
      }
      incompleteWeightBps += row.weightBps;
    }
  }

  return Object.freeze({
    rowCount: rows.length,
    totalWeightBps: rows.reduce(
      (total, row) => total + row.weightBps,
      0,
    ),
    storedEvidenceReadyWeightBps,
    provenanceReadyWeightBps,
    excludedWeightBps,
    manualHistoryRequiredWeightBps,
    incompleteWeightBps,
  });
}

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function uniqueSorted(values: readonly (string | null | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function isValidTimestamp(value: string | Date | null) {
  const timestamp =
    value instanceof Date ? value.getTime() : Date.parse(value ?? "");
  return Number.isFinite(timestamp);
}
