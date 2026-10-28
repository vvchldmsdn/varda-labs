/** Limited read-model port of baseline src/lib/simulation-private-owner-raw-history.ts.
 * Baseline SHA256 e513b7284f65540dd9d0aaffad473f7008f29e258d9f147aab89b7d3cb644136.
 * Shared market-data admission and owned-instrument filtering follow the preserved
 * original v3 source. Baseline raw prices, observation/date assembly, exclusions,
 * diagnostics and the unchanged raw v1 numeric matrix are retained deliberately.
 * This module is not authentication: its instruments must come from the existing
 * server-owned scope/portfolio read. No fabricated owner list is used.
 * The legacy matrix policy text is internal calculation provenance, not proof
 * of singleton authorization; TENANT_RAW_HISTORY_POLICY is the effective read
 * boundary. Matrix internals must not be copied into the public beta DTO.
 */
import {resolvePrivateOwnerRawAvailableServiceDates} from '../simulation-private-owner-raw-history.ts';
import {
  admitSharedKisRawHistoricalPriceRows,
  type RawHistoricalPriceConsumerEvidenceRow,
} from "./simulation-shared-admission.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
} from "../portfolio-risk-calendar.ts";
import type { PortfolioHoldingClassification } from "../portfolio-special-holdings.ts";
import {
  buildPrivateOwnerRawCloseSimulationReturnMatrix,
  type SimulationReturnMatrixFxInput,
  type SimulationReturnMatrixResult,
} from "../simulation-return-matrix.ts";
import type { SimulationHistoricalEvidenceStatus } from "../simulation-historical-evidence-admission-types.ts";

export const TENANT_RAW_HISTORY_POLICY = Object.freeze({
  version: "beta_tenant_owned_raw_history_v1",
  sourceAdmissionPolicy: "asset_price_snapshot_consumer_admission_v3.sharedKisRawHistoricalReturn",
  periodProjectionPolicy: "simulation_private_owner_raw_history_v1",
  matrixCalculationPolicy: "simulation_private_owner_raw_close_return_matrix_v1",
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

export type TenantRawHistoryInstrumentInput = Readonly<{
  instrumentKey: string;
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
  classification: PortfolioHoldingClassification;
  weightBps: number;
}>;

export type TenantRawHistoryResult = ReturnType<
  typeof buildTenantOwnedRawHistory
>;

export function buildTenantOwnedRawHistory(input: {
  requestedEndServiceDate: string;
  returnStepCount?: number;
  instruments: readonly TenantRawHistoryInstrumentInput[];
  priceRows: readonly RawHistoricalPriceConsumerEvidenceRow[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}) {
  const returnStepCount = resolveReturnStepCount(input.returnStepCount);
  const modeledInstruments = input.instruments.filter(
    (row) =>
      row.weightBps > 0 && row.classification === "listed_instrument",
  );
  const scopeRows = input.priceRows.filter(row => modeledInstruments.some(instrument => matchesInstrument(row, instrument)));
  const scopeAdmission = admitSharedKisRawHistoricalPriceRows(scopeRows);
  const admittedRows = scopeAdmission.rows;
  const requestedServiceDates = resolvePrivateOwnerRawServiceDates({
    endServiceDate: input.requestedEndServiceDate,
    instruments: modeledInstruments,
    returnStepCount,
    priceRows: admittedRows,
    fxRows: input.fxRows,
    requiresFx: modeledInstruments.some((row) => row.currency === "USD"),
  });
  const matrix =
    scopeAdmission.status === "ready" &&
    requestedServiceDates.length ===
      returnStepCount + 1 &&
    modeledInstruments.length > 0
      ? buildPrivateOwnerRawCloseSimulationReturnMatrix({
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
    policy: TENANT_RAW_HISTORY_POLICY,
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

export function resolveLatestCommonTenantRawServiceDate(input: {
  instruments: readonly TenantRawHistoryInstrumentInput[];
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
  instruments: readonly TenantRawHistoryInstrumentInput[];
  endServiceDate: string;
  returnStepCount: number;
  priceRows: readonly RawHistoricalPriceConsumerEvidenceRow[];
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

/** Filters the shared reference rows to the already authorized positive listed universe. */
export function resolveTenantRawAvailableServiceDates(input: {
 endServiceDate:string;instruments:readonly TenantRawHistoryInstrumentInput[];
 priceRows:readonly RawHistoricalPriceConsumerEvidenceRow[];fxRows:readonly SimulationReturnMatrixFxInput[];requiresFx:boolean;
}) {
 const modeled=input.instruments.filter(row=>row.weightBps>0&&row.classification==='listed_instrument');
 return resolvePrivateOwnerRawAvailableServiceDates({...input,priceRows:input.priceRows.filter(row=>modeled.some(instrument=>matchesInstrument(row,instrument)))});
}

function buildInstrumentEvidence(input: {
  instrument: TenantRawHistoryInstrumentInput;
  priceRows: readonly RawHistoricalPriceConsumerEvidenceRow[];
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
      priceBasis: TENANT_RAW_HISTORY_POLICY.priceBasis,
      adjustment: "not_claimed",
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
    : TENANT_RAW_HISTORY_POLICY.returnStepCount;
}

function terminalInstrument(
  instrument: TenantRawHistoryInstrumentInput,
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
  instrument: TenantRawHistoryInstrumentInput,
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
