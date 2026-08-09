import {
  admitPrivateSingleTenantRawHistoricalPriceRows,
  type RawHistoricalPriceConsumerEvidenceRow,
} from "./market-data/asset-price-consumer-admission.ts";
import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
} from "./portfolio-risk-calendar.ts";
import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";
import {
  buildPrivateOwnerRawCloseSimulationReturnMatrix,
  type SimulationReturnMatrixFxInput,
  type SimulationReturnMatrixResult,
} from "./simulation-return-matrix.ts";
import type { SimulationHistoricalEvidenceStatus } from "./simulation-historical-evidence-admission-types.ts";

export const PRIVATE_OWNER_RAW_HISTORY_POLICY = Object.freeze({
  version: "simulation_private_owner_raw_history_v1",
  purpose: "owner_only_simulation_research",
  ownerBoundary: "exactly_one_active_portfolio_owner_matching_session",
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
  requestedOwnerUserId: string;
  activeOwnerUserIds: readonly string[];
  requestedEndServiceDate: string;
  instruments: readonly PrivateOwnerRawHistoryInstrumentInput[];
  priceRows: readonly RawHistoricalPriceConsumerEvidenceRow[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}) {
  const modeledInstruments = input.instruments.filter(
    (row) =>
      row.weightBps > 0 && row.classification === "listed_instrument",
  );
  const scopeAdmission = admitPrivateSingleTenantRawHistoricalPriceRows({
    rows: input.priceRows,
    requestedOwnerUserId: input.requestedOwnerUserId,
    activeOwnerUserIds: input.activeOwnerUserIds,
  });
  const admittedRows = scopeAdmission.rows;
  const requestedServiceDates = resolvePrivateOwnerRawServiceDates({
    endServiceDate: input.requestedEndServiceDate,
    returnStepCount: PRIVATE_OWNER_RAW_HISTORY_POLICY.returnStepCount,
    priceRows: admittedRows,
    fxRows: input.fxRows,
    requiresFx: modeledInstruments.some((row) => row.currency === "USD"),
  });
  const matrix =
    scopeAdmission.status === "ready" &&
    requestedServiceDates.length ===
      PRIVATE_OWNER_RAW_HISTORY_POLICY.returnStepCount + 1 &&
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
      requestedOwnerUserId: input.requestedOwnerUserId,
      activeOwnerUserIds: input.activeOwnerUserIds,
      priceRows: input.priceRows.filter((row) =>
        matchesInstrument(row, instrument),
      ),
      requestedServiceDates,
      matrix,
    }),
  );

  return Object.freeze({
    policy: PRIVATE_OWNER_RAW_HISTORY_POLICY,
    requestedEndServiceDate: input.requestedEndServiceDate,
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
  requestedOwnerUserId: string;
  activeOwnerUserIds: readonly string[];
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

  if (
    !hasPrivateOwnerScope(
      input.requestedOwnerUserId,
      input.activeOwnerUserIds,
    )
  ) {
    return null;
  }

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
  returnStepCount: number;
  priceRows: readonly RawHistoricalPriceConsumerEvidenceRow[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
  requiresFx: boolean;
}) {
  if (!isRiskDate(input.endServiceDate)) return Object.freeze([] as string[]);

  const dates = new Set(
    input.priceRows
      .map((row) => mapRiskEvidenceDateToServiceDate(row.priceDate))
      .filter((date) => date <= input.endServiceDate),
  );
  if (input.requiresFx) {
    for (const row of input.fxRows) {
      if (
        row.status.trim().toLowerCase() !== "ok" ||
        positiveNumber(row.usdKrw) === null ||
        !isRiskDate(row.rateDate)
      ) {
        continue;
      }
      const serviceDate = mapRiskEvidenceDateToServiceDate(row.rateDate);
      if (serviceDate <= input.endServiceDate) dates.add(serviceDate);
    }
  }

  const sorted = [...dates].sort();
  const endIndex = sorted.indexOf(input.endServiceDate);
  const requiredPointCount = input.returnStepCount + 1;
  const startIndex = endIndex - requiredPointCount + 1;
  return Object.freeze(
    endIndex >= 0 && startIndex >= 0
      ? sorted.slice(startIndex, endIndex + 1)
      : [],
  );
}

function buildInstrumentEvidence(input: {
  instrument: PrivateOwnerRawHistoryInstrumentInput;
  requestedOwnerUserId: string;
  activeOwnerUserIds: readonly string[];
  priceRows: readonly RawHistoricalPriceConsumerEvidenceRow[];
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

  const admission = admitPrivateSingleTenantRawHistoricalPriceRows({
    rows: input.priceRows,
    requestedOwnerUserId: input.requestedOwnerUserId,
    activeOwnerUserIds: input.activeOwnerUserIds,
  });
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
      PRIVATE_OWNER_RAW_HISTORY_POLICY.returnStepCount + 1 &&
    cells?.length === PRIVATE_OWNER_RAW_HISTORY_POLICY.returnStepCount &&
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
      requiredReturnCount: PRIVATE_OWNER_RAW_HISTORY_POLICY.returnStepCount,
      reasons: Object.freeze(
        [...missingReasons].filter((value) => value !== null),
      ),
    }),
    provenance: Object.freeze({
      status: admission.status === "ready" ? "complete" : "incomplete",
      priceBasis: PRIVATE_OWNER_RAW_HISTORY_POLICY.priceBasis,
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

function hasPrivateOwnerScope(
  requestedOwnerUserId: string,
  activeOwnerUserIds: readonly string[],
) {
  const requested = normalizeText(requestedOwnerUserId)?.toLowerCase();
  const active = [
    ...new Set(
      activeOwnerUserIds
        .map((value) => normalizeText(value)?.toLowerCase())
        .filter((value): value is string => value !== null),
    ),
  ];
  return Boolean(requested && active.length === 1 && active[0] === requested);
}

function positiveNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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
