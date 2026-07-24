import { buildSimulationReturnMatrix } from "./simulation-return-matrix.ts";
import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";
import {
  SIMULATION_HISTORICAL_EVIDENCE_ADMISSION_POLICY,
  type SimulationHistoricalEvidenceAdmission,
  type SimulationHistoricalEvidenceIssue,
  type SimulationHistoricalEvidencePriceInput,
  type SimulationHistoricalEvidenceStatus,
} from "./simulation-historical-evidence-admission-types.ts";
import type {
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixPriceInput,
  SimulationReturnMatrixResult,
} from "./simulation-return-matrix-types.ts";

export {
  SIMULATION_HISTORICAL_EVIDENCE_ADMISSION_POLICY,
  type SimulationHistoricalEvidenceAdmission,
  type SimulationHistoricalEvidenceIssue,
  type SimulationHistoricalEvidencePriceInput,
  type SimulationHistoricalEvidenceStatus,
} from "./simulation-historical-evidence-admission-types.ts";

export function admitSimulationHistoricalEvidence(input: {
  classification: PortfolioHoldingClassification;
  instrument: Readonly<{
    market: string | null;
    currency: string | null;
    ticker: string | null;
  }>;
  providerBinding: Readonly<{
    provider: string | null;
    symbol: string | null;
    exchange: string | null;
  }> | null;
  requestedServiceDates: readonly string[];
  priceRows: readonly SimulationHistoricalEvidencePriceInput[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}): SimulationHistoricalEvidenceAdmission {
  const suppliedPriceRows = Array.isArray(input.priceRows) ? input.priceRows : [];
  const requestedServiceDates = Array.isArray(input.requestedServiceDates)
    ? input.requestedServiceDates
    : [];
  const classification = input.classification;
  const instrument = normalizeInstrument(input.instrument);

  if (classification === "managed_sleeve") {
    return terminalAdmission({
      status: "excluded_by_policy",
      classification,
      instrumentKey: instrument?.instrumentKey ?? null,
      suppliedPriceRowCount: suppliedPriceRows.length,
      requestedServiceDateCount: requestedServiceDates.length,
    });
  }
  if (classification === "physical_commodity_position") {
    return terminalAdmission({
      status: "manual_history_required",
      classification,
      instrumentKey: instrument?.instrumentKey ?? null,
      suppliedPriceRowCount: suppliedPriceRows.length,
      requestedServiceDateCount: requestedServiceDates.length,
    });
  }
  if (classification !== "listed_instrument" || !instrument) {
    return terminalAdmission({
      status: "blocked_invalid_input",
      classification,
      instrumentKey: instrument?.instrumentKey ?? null,
      issues: ["invalid_instrument_identity"],
      suppliedPriceRowCount: suppliedPriceRows.length,
      requestedServiceDateCount: requestedServiceDates.length,
    });
  }

  const providerBinding = normalizeProviderBinding(input.providerBinding);
  if (!providerBinding) {
    return terminalAdmission({
      status: "provider_binding_missing",
      classification,
      instrumentKey: instrument.instrumentKey,
      issues: ["provider_binding_missing"],
      suppliedPriceRowCount: suppliedPriceRows.length,
      requestedServiceDateCount: requestedServiceDates.length,
    });
  }

  const issues = new Set<SimulationHistoricalEvidenceIssue>();
  const admittedPriceRows: SimulationReturnMatrixPriceInput[] = [];
  let ineligiblePriceRowCount = 0;

  for (const row of suppliedPriceRows) {
    if (!matchesInstrument(row, instrument)) {
      issues.add("price_identity_mismatch");
      continue;
    }
    if (!matchesProviderBinding(row, providerBinding)) {
      issues.add("provider_binding_mismatch");
      continue;
    }
    if (
      row.adjustedCloseBasis !==
      SIMULATION_HISTORICAL_EVIDENCE_ADMISSION_POLICY.admittedAdjustedCloseBasis
    ) {
      issues.add("adjusted_close_basis_ineligible");
      ineligiblePriceRowCount += 1;
      continue;
    }
    if (!normalizeText(row.adjustedCloseSource)) {
      issues.add("adjusted_close_source_missing");
      ineligiblePriceRowCount += 1;
      continue;
    }
    if (!isValidTimestamp(row.adjustedCloseFetchedAt)) {
      issues.add("adjusted_close_fetched_at_invalid");
      ineligiblePriceRowCount += 1;
      continue;
    }

    admittedPriceRows.push({
      market: instrument.market,
      currency: instrument.currency,
      ticker: instrument.ticker,
      priceDate: row.priceDate,
      adjustedClosePrice: row.adjustedClosePrice,
    });
  }

  if (issues.has("price_identity_mismatch") || issues.has("provider_binding_mismatch")) {
    issues.add("matrix_input_invalid");
    return terminalAdmission({
      status: "blocked_invalid_input",
      classification,
      instrumentKey: instrument.instrumentKey,
      issues: [...issues],
      suppliedPriceRowCount: suppliedPriceRows.length,
      admittedPriceRowCount: admittedPriceRows.length,
      ineligiblePriceRowCount,
      requestedServiceDateCount: requestedServiceDates.length,
    });
  }

  if (admittedPriceRows.length === 0 && ineligiblePriceRowCount > 0) {
    return terminalAdmission({
      status: "price_basis_ineligible",
      classification,
      instrumentKey: instrument.instrumentKey,
      issues: [...issues],
      suppliedPriceRowCount: suppliedPriceRows.length,
      admittedPriceRowCount: 0,
      ineligiblePriceRowCount,
      requestedServiceDateCount: requestedServiceDates.length,
    });
  }

  const matrix = buildSimulationReturnMatrix({
    requestedServiceDates,
    instruments: [
      {
        market: instrument.market,
        currency: instrument.currency,
        ticker: instrument.ticker,
        historyStatus: "instrument_keyed",
      },
    ],
    priceRows: admittedPriceRows,
    fxRows: input.fxRows,
  });

  if (matrix.status === "blocked") {
    issues.add("matrix_input_invalid");
    return matrixAdmission(
      "blocked_invalid_input",
      classification,
      instrument.instrumentKey,
      issues,
      suppliedPriceRows.length,
      admittedPriceRows.length,
      ineligiblePriceRowCount,
      matrix,
    );
  }

  if (matrix.summary.incompleteCellCount > 0) {
    const missingReasons = new Set(
      matrix.matrix.flatMap((row) =>
        row.cells.flatMap((cell) => [
          cell.previous.reason,
          cell.current.reason,
        ]),
      ),
    );
    if (missingReasons.has("missing_price") || missingReasons.has("stale_price")) {
      issues.add("price_history_incomplete");
    }
    if (missingReasons.has("missing_fx") || missingReasons.has("stale_fx")) {
      issues.add("fx_incomplete");
    }
    const status = issues.has("price_history_incomplete")
      ? "price_history_incomplete"
      : "fx_incomplete";
    return matrixAdmission(
      status,
      classification,
      instrument.instrumentKey,
      issues,
      suppliedPriceRows.length,
      admittedPriceRows.length,
      ineligiblePriceRowCount,
      matrix,
    );
  }

  return matrixAdmission(
    "ready",
    classification,
    instrument.instrumentKey,
    issues,
    suppliedPriceRows.length,
    admittedPriceRows.length,
    ineligiblePriceRowCount,
    matrix,
  );
}

function normalizeInstrument(input: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}) {
  const market = normalizeText(input.market)?.toLowerCase() ?? null;
  const currency = normalizeText(input.currency)?.toUpperCase() ?? null;
  const ticker = normalizeText(input.ticker)?.toUpperCase() ?? null;
  if (!market || !ticker || (currency !== "KRW" && currency !== "USD")) {
    return null;
  }
  return Object.freeze({
    market,
    currency,
    ticker,
    instrumentKey: `${market}|${currency}|${ticker}`,
  });
}

function normalizeProviderBinding(
  input: {
    provider: string | null;
    symbol: string | null;
    exchange: string | null;
  } | null,
) {
  const provider = normalizeText(input?.provider);
  const symbol = normalizeText(input?.symbol)?.toUpperCase() ?? null;
  const exchange = normalizeText(input?.exchange)?.toUpperCase() ?? null;
  return provider && symbol && exchange
    ? Object.freeze({ provider, symbol, exchange })
    : null;
}

function matchesInstrument(
  row: SimulationHistoricalEvidencePriceInput,
  instrument: NonNullable<ReturnType<typeof normalizeInstrument>>,
) {
  return (
    normalizeText(row.market)?.toLowerCase() === instrument.market &&
    normalizeText(row.currency)?.toUpperCase() === instrument.currency &&
    normalizeText(row.ticker)?.toUpperCase() === instrument.ticker
  );
}

function matchesProviderBinding(
  row: SimulationHistoricalEvidencePriceInput,
  provider: NonNullable<ReturnType<typeof normalizeProviderBinding>>,
) {
  return (
    normalizeText(row.adjustedCloseProvider)?.toLowerCase() ===
      provider.provider.toLowerCase() &&
    normalizeText(row.providerSymbol)?.toUpperCase() === provider.symbol &&
    normalizeText(row.providerExchange)?.toUpperCase() === provider.exchange
  );
}

function terminalAdmission(input: {
  status: SimulationHistoricalEvidenceStatus;
  classification: PortfolioHoldingClassification;
  instrumentKey: string | null;
  issues?: readonly SimulationHistoricalEvidenceIssue[];
  suppliedPriceRowCount: number;
  admittedPriceRowCount?: number;
  ineligiblePriceRowCount?: number;
  requestedServiceDateCount: number;
}): SimulationHistoricalEvidenceAdmission {
  return Object.freeze({
    policy: SIMULATION_HISTORICAL_EVIDENCE_ADMISSION_POLICY,
    status: input.status,
    classification: input.classification,
    instrumentKey: input.instrumentKey,
    issues: Object.freeze([...(input.issues ?? [])].sort()),
    evidence: Object.freeze({
      suppliedPriceRowCount: input.suppliedPriceRowCount,
      admittedPriceRowCount: input.admittedPriceRowCount ?? 0,
      ineligiblePriceRowCount: input.ineligiblePriceRowCount ?? 0,
      requestedServiceDateCount: input.requestedServiceDateCount,
      readyCellCount: 0,
      incompleteCellCount: 0,
      coveragePct: 0,
    }),
    matrix: null,
  });
}

function matrixAdmission(
  status: SimulationHistoricalEvidenceStatus,
  classification: PortfolioHoldingClassification,
  instrumentKey: string,
  issues: ReadonlySet<SimulationHistoricalEvidenceIssue>,
  suppliedPriceRowCount: number,
  admittedPriceRowCount: number,
  ineligiblePriceRowCount: number,
  matrix: SimulationReturnMatrixResult,
): SimulationHistoricalEvidenceAdmission {
  return Object.freeze({
    policy: SIMULATION_HISTORICAL_EVIDENCE_ADMISSION_POLICY,
    status,
    classification,
    instrumentKey,
    issues: Object.freeze([...issues].sort()),
    evidence: Object.freeze({
      suppliedPriceRowCount,
      admittedPriceRowCount,
      ineligiblePriceRowCount,
      requestedServiceDateCount: matrix.requestedServiceDates.length,
      readyCellCount: matrix.summary.readyCellCount,
      incompleteCellCount: matrix.summary.incompleteCellCount,
      coveragePct: matrix.summary.coveragePct,
    }),
    matrix,
  });
}

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function isValidTimestamp(value: string | Date | null) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value ?? "");
  return Number.isFinite(timestamp);
}
