import { simulationExpectedServiceDates } from "./simulation-market-calendar.ts";
import {
  admitSharedKisRawHistoricalPriceRows,
  admitAdjustedHistoricalPriceRows,
  type AdjustedHistoricalPriceConsumerEvidenceRow,
  type RawHistoricalPriceConsumerEvidenceRow,
} from "./market-data/asset-price-consumer-admission.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
} from "./portfolio-risk-calendar.ts";
import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";
import {
  buildCalendarAlignedPrivateOwnerRawCloseMatrix,
  buildCalendarAlignedAdjustedMatrix,
  type SimulationReturnMatrixFxInput,
  type SimulationReturnMatrixResult,
} from "./simulation-return-matrix.ts";
import type { SimulationHistoricalEvidenceStatus } from "./simulation-historical-evidence-admission-types.ts";

export const PRIVATE_OWNER_RAW_HISTORY_POLICY = Object.freeze({
  version: "simulation_private_owner_raw_history_v3",
  purpose: "tenant_scoped_simulation_research",
  ownerBoundary: "user_owned_instrument_universe",
  marketDataBoundary: "shared_instrument_date_cache",
  providerBoundary: "stored_complete_kis_raw_close_only",
  returnStepCount: 90,
  priceBasis: "raw_price_return",
  corporateActionAdjustment: "not_claimed",
  distributionAdjustment: "not_claimed",
  fxPolicy: "date_specific_usdkrw",
  missingPolicy: "preserve_diagnostics_and_block_incomplete_matrix",
  persistence: "forbidden",
  providerCalls: "forbidden",
  recommendation: "forbidden",
  orderAuthority: "forbidden",
} as const);

export type PrivateOwnerRawHistoryInstrumentInput = Readonly<{
  instrumentKey: string;
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
  classification: PortfolioHoldingClassification;
  weightBps: number;
}>;

export type PrivateOwnerRawHistoryResult = ReturnType<
  typeof buildPrivateOwnerRawHistory
>;

export function buildPrivateOwnerRawHistory(input: {
  requireAdjusted?: boolean;
  requestedEndServiceDate: string;
  sourceDateFrom?: string;
  returnStepCount?: number;
  instruments: readonly PrivateOwnerRawHistoryInstrumentInput[];
  priceRows: readonly (RawHistoricalPriceConsumerEvidenceRow & Partial<AdjustedHistoricalPriceConsumerEvidenceRow>)[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}) {
  const returnStepCount = resolveReturnStepCount(input.returnStepCount);
  const modeledInstruments = input.instruments.filter(
    (row) =>
      row.weightBps > 0 && row.classification === "listed_instrument",
  );
  const scopeRows = input.priceRows.filter(row => modeledInstruments.some(instrument => matchesInstrument(row, instrument)));
  const scopeAdmission = admitSharedKisRawHistoricalPriceRows(scopeRows);
  const adjustedRows=scopeRows.filter((row):row is RawHistoricalPriceConsumerEvidenceRow & AdjustedHistoricalPriceConsumerEvidenceRow=>
    row.adjustedCloseProvider==="kis" && row.adjustedCloseSource?.endsWith(":adjusted_v1")===true);
  const adjustedAdmission=admitAdjustedHistoricalPriceRows(adjustedRows);
  const useAdjusted=adjustedRows.length>0 && adjustedAdmission.rows.length===scopeRows.length && adjustedAdmission.issues.length===0;

  const admittedRows = scopeAdmission.rows;
  const requestedServiceDates = resolvePrivateOwnerRawServiceDates({
    endServiceDate: input.requestedEndServiceDate,
    sourceDateFrom: input.sourceDateFrom,
    instruments: modeledInstruments,
    returnStepCount,
    priceRows: admittedRows,
    fxRows: input.fxRows,
    requiresFx: modeledInstruments.some((row) => row.currency === "USD"),
  });
  const rawMatrix =
    scopeAdmission.status === "ready" &&
    requestedServiceDates.length ===
      returnStepCount + 1 &&
    modeledInstruments.length > 0
      ? buildCalendarAlignedPrivateOwnerRawCloseMatrix({
          requestedServiceDates,
          instruments: modeledInstruments.map((row) => ({
            market: row.market,
            currency: row.currency,
            ticker: row.ticker,
            historyStatus: "instrument_keyed" as const,
          })),
          priceRows: admittedRows.map((row) => ({
            market: row.market,
            currency: row.currency,
            ticker: row.ticker,
            priceDate: row.priceDate,
            rawClosePrice: row.closePrice,
          })),
          fxRows: input.fxRows,
        })
      : null;
  const matrix=(useAdjusted || input.requireAdjusted) && requestedServiceDates.length===returnStepCount+1
    ? buildCalendarAlignedAdjustedMatrix({requestedServiceDates,instruments:modeledInstruments.map(row=>({...row,historyStatus:"instrument_keyed" as const})),priceRows:adjustedAdmission.rows.map(({market,currency,ticker,priceDate,adjustedClosePrice})=>({market,currency,ticker,priceDate,adjustedClosePrice})),fxRows:input.fxRows})
    : rawMatrix;
  const instruments = input.instruments.map((instrument) =>
    buildInstrumentEvidence({
      instrument,
      priceRows: input.priceRows.filter((row) =>
        matchesInstrument(row, instrument),
      ),
      returnStepCount,
      requestedServiceDates,
      matrix,
    }),
  );

  return Object.freeze({
    policy: useAdjusted || input.requireAdjusted ? Object.freeze({...PRIVATE_OWNER_RAW_HISTORY_POLICY,
      version:"simulation_private_owner_adjusted_history_v4",providerBoundary:"stored_complete_kis_paired_adjusted_only",priceBasis:"provider_adjusted_close",corporateActionAdjustment:"provider_claimed"}) : PRIVATE_OWNER_RAW_HISTORY_POLICY,
    requestedEndServiceDate: input.requestedEndServiceDate,
    requestedReturnStepCount: returnStepCount,
    status:
      matrix?.status === "ready" &&
      instruments
        .filter(
          (row) =>
            row.weightBps > 0 &&
            row.classification === "listed_instrument",
        )
        .every(
          (row) =>
            row.status === "provenance_ready_for_separate_review" &&
            row.admissionStatus === "ready",
        )
        ? ("ready" as const)
        : scopeAdmission.status === "blocked" || matrix?.status === "blocked"
          ? ("blocked" as const)
          : ("incomplete" as const),
    scopeAdmission: Object.freeze({
      status: scopeAdmission.status,
      issues: scopeAdmission.issues,
    }),
    requestedServiceDates,
    instruments: Object.freeze(instruments),
    matrix,
  });
}

export function resolveLatestCommonPrivateOwnerRawServiceDate(input: {
  instruments: readonly PrivateOwnerRawHistoryInstrumentInput[];
  latestSourceRows: readonly Readonly<{
    market: string;
    currency: string;
    ticker: string;
    latestSourceDate: string | null;
    providerBindingCount: number;
  }>[];
  latestFxSourceDate: string | null;
}) {
  const modeledInstruments = input.instruments.filter(
    (row) =>
      row.weightBps > 0 && row.classification === "listed_instrument",
  );
  if (modeledInstruments.length === 0) return null;

  const serviceDates: string[] = [];
  for (const instrument of modeledInstruments) {
    const latest = input.latestSourceRows.find((row) =>
      matchesInstrument(row, instrument),
    );
    if (
      !latest?.latestSourceDate ||
      !isRiskDate(latest.latestSourceDate) ||
      Number(latest.providerBindingCount) !== 1
    ) {
      return null;
    }
    serviceDates.push(
      mapRiskEvidenceDateToServiceDate(latest.latestSourceDate),
    );
  }
  if (modeledInstruments.some((row) => row.currency === "USD")) {
    if (!input.latestFxSourceDate) return null;
    serviceDates.push(
      mapRiskEvidenceDateToServiceDate(input.latestFxSourceDate),
    );
  }

  return serviceDates.sort()[0] ?? null;
}

function resolvePrivateOwnerRawServiceDates(input: {
  endServiceDate: string;
  sourceDateFrom?: string;
  instruments: readonly PrivateOwnerRawHistoryInstrumentInput[];
  returnStepCount: number;
  priceRows: readonly (RawHistoricalPriceConsumerEvidenceRow & Partial<AdjustedHistoricalPriceConsumerEvidenceRow>)[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
  requiresFx: boolean;
}) {
  const sorted = resolvePrivateOwnerRawAvailableServiceDates(input);
  const endIndex = sorted.indexOf(input.endServiceDate);
  const requiredPointCount = input.returnStepCount + 1;
  const startIndex = endIndex - requiredPointCount + 1;
  return Object.freeze(
    endIndex >= 0 && startIndex >= 0
      ? sorted.slice(startIndex, endIndex + 1)
      : [],
  );
}

export function resolvePrivateOwnerRawAvailableServiceDates(input: {
  endServiceDate: string;
  sourceDateFrom?: string;
  instruments: readonly PrivateOwnerRawHistoryInstrumentInput[];
  priceRows: readonly (RawHistoricalPriceConsumerEvidenceRow & Partial<AdjustedHistoricalPriceConsumerEvidenceRow>)[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
  requiresFx: boolean;
}) {
  const modeled = input.instruments.filter(row => row.weightBps > 0 && row.classification === "listed_instrument");
  // The real DAL supplies its bounded scan start, so an entirely absent trading day
  // cannot disappear from the time axis. Pure callers may derive only their supplied range.
  const start = input.sourceDateFrom ?? input.priceRows.filter(row => isRiskDate(row.priceDate) &&
    modeled.some(instrument => matchesInstrument(row, instrument))).map(row => row.priceDate).sort()[0];
  return start ? simulationExpectedServiceDates([...new Set(modeled.map(row => row.market))], start, input.endServiceDate)
    : Object.freeze([] as string[]);
}

function buildInstrumentEvidence(input: {
  instrument: PrivateOwnerRawHistoryInstrumentInput;
  priceRows: readonly (RawHistoricalPriceConsumerEvidenceRow & Partial<AdjustedHistoricalPriceConsumerEvidenceRow>)[];
  returnStepCount: number;
  requestedServiceDates: readonly string[];
  matrix: SimulationReturnMatrixResult | null;
}) {
  const instrument = input.instrument;
  if (instrument.weightBps === 0) {
    return terminalInstrument(instrument, "zero_weight_not_evaluated", null);
  }
  if (instrument.classification === "managed_sleeve") {
    return terminalInstrument(
      instrument,
      "excluded_by_policy",
      "excluded_by_policy",
    );
  }
  if (instrument.classification === "physical_commodity_position") {
    return terminalInstrument(
      instrument,
      "manual_history_required",
      "manual_history_required",
    );
  }
  if (instrument.classification !== "listed_instrument") {
    return terminalInstrument(instrument, "identity_unresolved", null);
  }

  const admission = admitSharedKisRawHistoricalPriceRows(input.priceRows);
  const cells = input.matrix?.matrix.flatMap((row) =>
    row.cells.filter(
      (cell) => cell.instrumentKey === instrument.instrumentKey,
    ),
  );
  const missingReasons = new Set(
    (cells ?? []).flatMap((cell) => [
      cell.previous.reason,
      cell.current.reason,
    ]),
  );
  const complete =
    admission.status === "ready" &&
    input.requestedServiceDates.length ===
      input.returnStepCount + 1 &&
    cells?.length === input.returnStepCount &&
    cells.every((cell) => cell.value !== null);
  const admissionStatus: SimulationHistoricalEvidenceStatus = complete
    ? "ready"
    : admission.status === "blocked"
      ? "blocked_invalid_input"
      : missingReasons.has("missing_fx") || missingReasons.has("stale_fx")
        ? "fx_incomplete"
        : "price_history_incomplete";
  const sources = uniqueSorted(
    admission.rows.map((row) => normalizeText(row.source)?.toLowerCase()),
  );
  const providerSymbols = uniqueSorted(
    admission.rows.map((row) => normalizeText(row.providerSymbol)?.toUpperCase()),
  );
  const providerExchanges = uniqueSorted(
    admission.rows.map((row) =>
      normalizeText(row.providerExchange)?.toUpperCase(),
    ),
  );

  return Object.freeze({
    ...instrument,
    status: complete
      ? ("provenance_ready_for_separate_review" as const)
      : admission.status === "blocked"
        ? ("provenance_incomplete" as const)
        : ("stored_coverage_incomplete" as const),
    admissionStatus,
    storedCoverage: Object.freeze({
      status: complete ? ("ready" as const) : ("incomplete" as const),
      readyReturnCount: (cells ?? []).filter((cell) => cell.value !== null)
        .length,
      requiredReturnCount: input.returnStepCount,
      reasons: Object.freeze(
        [...missingReasons].filter((value) => value !== null),
      ),
    }),
    provenance: Object.freeze({
      status: admission.status === "ready" ? "complete" : "incomplete",
      priceBasis: input.matrix?.policy.priceField === "adjusted_close_price_only" ? "provider_adjusted_close" : PRIVATE_OWNER_RAW_HISTORY_POLICY.priceBasis,
      adjustment: input.matrix?.policy.priceField === "adjusted_close_price_only" ? "provider_claimed" : "not_claimed",
      storedRowCount: input.priceRows.length,
      rawCloseRowCount: admission.rows.length,
      qualifiedRowCount: admission.rows.length,
      sourceDateFrom: admission.rows[0]?.priceDate ?? null,
      sourceDateTo: admission.rows.at(-1)?.priceDate ?? null,
      sources: Object.freeze(sources),
      providerSymbols: Object.freeze(providerSymbols),
      providerExchanges: Object.freeze(providerExchanges),
      issues: admission.issues,
    }),
  });
}

function resolveReturnStepCount(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0
    ? (value as number)
    : PRIVATE_OWNER_RAW_HISTORY_POLICY.returnStepCount;
}

function terminalInstrument(
  instrument: PrivateOwnerRawHistoryInstrumentInput,
  status:
    | "zero_weight_not_evaluated"
    | "excluded_by_policy"
    | "manual_history_required"
    | "identity_unresolved",
  admissionStatus: SimulationHistoricalEvidenceStatus | null,
) {
  return Object.freeze({
    ...instrument,
    status,
    admissionStatus,
    storedCoverage: null,
    provenance: null,
  });
}

function matchesInstrument(
  row: Readonly<{ market: string; currency: string; ticker: string }>,
  instrument: PrivateOwnerRawHistoryInstrumentInput,
) {
  return (
    row.market.trim().toLowerCase() === instrument.market &&
    row.currency.trim().toUpperCase() === instrument.currency &&
    row.ticker.trim().toUpperCase() === instrument.ticker
  );
}

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function uniqueSorted(values: readonly (string | null | undefined)[]) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ].sort();
}
