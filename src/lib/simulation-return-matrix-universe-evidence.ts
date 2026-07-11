import { createHash } from "node:crypto";

import {
  latestRiskObservationOnOrBefore,
  shiftRiskDate,
} from "./portfolio-risk-calendar.ts";
import {
  SIMULATION_RETURN_MATRIX_POLICY,
  buildSimulationReturnMatrix,
} from "./simulation-return-matrix.ts";
import {
  normalizeSimulationFxRows,
  normalizeSimulationPriceRows,
} from "./simulation-return-matrix-normalization.ts";
import type {
  SimulationFxObservation,
  SimulationPriceObservation,
  SimulationReturnMatrixFxInput,
  SimulationReturnMatrixInstrument,
  SimulationReturnMatrixPriceInput,
} from "./simulation-return-matrix-types.ts";

export const SIMULATION_RETURN_MATRIX_UNIVERSE_EVIDENCE_POLICY = Object.freeze({
  version: "simulation_return_matrix_universe_evidence_v1",
  scenarioUniverseHashVersion: "simulation_scenario_universe_hash_v1",
  matrixRequestHashVersion: "simulation_return_matrix_request_hash_v1",
  identityPolicyVersion: "market_currency_ticker_identity_v1",
  returnMatrixPolicyVersion: SIMULATION_RETURN_MATRIX_POLICY.version,
  basisPolicy: Object.freeze({
    returnKind: SIMULATION_RETURN_MATRIX_POLICY.returnKind,
    priceField: SIMULATION_RETURN_MATRIX_POLICY.priceField,
    fxPolicy: SIMULATION_RETURN_MATRIX_POLICY.fxPolicy,
    supportedCurrencies: Object.freeze(["KRW", "USD"] as const),
  }),
  priceSource: "asset_price_snapshots",
  fxSource: "fx_rates",
  sampleRows: "excluded",
  fxStatus: "ok_only",
  scenarioUniverseHashContent:
    "identity_basis_policy_and_canonical_instrument_identities",
  matrixRequestHashContent:
    "scenario_universe_hash_exact_service_dates_and_matrix_policies",
} as const);

export type SimulationReturnMatrixUniverseCandidate = Readonly<{
  displayName?: string | null;
  market: string | null;
  currency: string | null;
  ticker: string | null;
}>;

export type SimulationReturnMatrixUniverseRequest = Readonly<{
  requestedServiceDates: readonly string[];
  instruments: readonly SimulationReturnMatrixUniverseCandidate[];
}>;

export type SimulationReturnMatrixUniverseQueryRange = Readonly<{
  priceSourceDateFrom: string;
  fxSourceDateFrom: string | null;
  sourceDateTo: string;
}>;

export type SimulationReturnMatrixUniverseReadPlan = Readonly<{
  status: "blocked" | "queryable";
  queryRange: SimulationReturnMatrixUniverseQueryRange | null;
  instruments: readonly SimulationReturnMatrixInstrument[];
  requiresFx: boolean;
}>;

export function planSimulationReturnMatrixUniverseRead(
  request: SimulationReturnMatrixUniverseRequest,
): SimulationReturnMatrixUniverseReadPlan {
  const preflight = buildRequestPreflight(request);
  if (preflight.status === "blocked") {
    return Object.freeze({
      status: "blocked",
      queryRange: null,
      instruments: preflight.instruments,
      requiresFx: false,
    });
  }

  const firstServiceDate = preflight.requestedServiceDates[0];
  const lastServiceDate = preflight.requestedServiceDates.at(-1);
  if (!firstServiceDate || !lastServiceDate) {
    return Object.freeze({
      status: "blocked",
      queryRange: null,
      instruments: preflight.instruments,
      requiresFx: false,
    });
  }

  const requiresFx = preflight.instruments.some(
    (row) => row.currency === "USD",
  );
  return Object.freeze({
    status: "queryable",
    queryRange: Object.freeze({
      priceSourceDateFrom: shiftRiskDate(
        firstServiceDate,
        -(SIMULATION_RETURN_MATRIX_POLICY.maxPriceCarryDays + 1),
      ),
      fxSourceDateFrom: requiresFx
        ? shiftRiskDate(
            firstServiceDate,
            -(SIMULATION_RETURN_MATRIX_POLICY.maxFxCarryDays + 1),
          )
        : null,
      sourceDateTo: shiftRiskDate(lastServiceDate, -1),
    }),
    instruments: preflight.instruments,
    requiresFx,
  });
}

export function composeSimulationReturnMatrixUniverseEvidence(input: {
  request: SimulationReturnMatrixUniverseRequest;
  queryRange: SimulationReturnMatrixUniverseQueryRange | null;
  priceRows: readonly SimulationReturnMatrixPriceInput[];
  fxRows: readonly SimulationReturnMatrixFxInput[];
}) {
  const preflight = buildRequestPreflight(input.request);
  const matrix = buildSimulationReturnMatrix({
    requestedServiceDates: input.request.requestedServiceDates,
    instruments: input.request.instruments.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      historyStatus: "instrument_keyed" as const,
    })),
    priceRows: input.priceRows,
    fxRows: input.fxRows,
  });
  const displayNames = displayNamesByInstrumentKey(input.request.instruments);
  const normalizedPrices = normalizeSimulationPriceRows({
    rows: input.priceRows,
    instruments: matrix.instruments,
    serviceDates: matrix.requestedServiceDates,
    maxCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxPriceCarryDays,
  });
  const normalizedFx = normalizeSimulationFxRows({
    rows: input.fxRows,
    required: matrix.instruments.some((row) => row.currency === "USD"),
    serviceDates: matrix.requestedServiceDates,
    maxCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxFxCarryDays,
  });
  const requiredReturnCount = Math.max(
    matrix.requestedServiceDates.length - 1,
    0,
  );
  const cellsByInstrument = new Map(
    matrix.instruments.map((instrument) => [
      instrument.instrumentKey,
      matrix.matrix.flatMap((row) =>
        row.cells.filter(
          (cell) => cell.instrumentKey === instrument.instrumentKey,
        ),
      ),
    ]),
  );
  const instruments = matrix.instruments.map((instrument) => {
    const priceCoverage = summarizeObservationCoverage({
      serviceDates: matrix.requestedServiceDates,
      observations:
        normalizedPrices.seriesByInstrument.get(instrument.instrumentKey) ?? [],
      maxCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxPriceCarryDays,
      missingReason: "missing_price",
      staleReason: "stale_price",
    });
    const fxCoverage =
      instrument.currency === "USD"
        ? summarizeObservationCoverage({
            serviceDates: matrix.requestedServiceDates,
            observations: normalizedFx.series,
            maxCarryDays: SIMULATION_RETURN_MATRIX_POLICY.maxFxCarryDays,
            missingReason: "missing_fx",
            staleReason: "stale_fx",
          })
        : Object.freeze({ status: "not_required" as const });
    const cells = cellsByInstrument.get(instrument.instrumentKey) ?? [];
    const readyReturnCount = cells.filter((cell) => cell.value !== null).length;
    const reasons = new Set<string>(priceCoverage.reasons);
    if (fxCoverage.status === "required") {
      for (const reason of fxCoverage.reasons) reasons.add(reason);
    }
    const relevantBlockers = matrix.blockers
      .filter(
        (blocker) =>
          blocker.instrumentKey === null ||
          blocker.instrumentKey === instrument.instrumentKey,
      )
      .map((blocker) => blocker.reason);
    for (const blocker of relevantBlockers) reasons.add(blocker);

    return Object.freeze({
      instrumentKey: instrument.instrumentKey,
      displayName: displayNames.get(instrument.instrumentKey) ?? null,
      market: instrument.market,
      currency: instrument.currency,
      ticker: instrument.ticker,
      status:
        matrix.status === "blocked"
          ? ("blocked" as const)
          : readyReturnCount === requiredReturnCount && reasons.size === 0
            ? ("ready" as const)
            : ("incomplete" as const),
      priceCoverage,
      fxCoverage,
      returnCoverage: Object.freeze({
        requiredReturnCount,
        readyReturnCount,
        coveragePct: percentage(readyReturnCount, requiredReturnCount),
      }),
      reasons: Object.freeze([...reasons].sort()),
    });
  });
  const scenarioUniverseHash = isScenarioUniverseHashable(preflight)
    ? hashSimulationScenarioUniverse(
        canonicalizeSimulationScenarioUniverse({
          instruments: preflight.instruments,
        }),
      )
    : null;
  const matrixRequestHash =
    scenarioUniverseHash && preflight.requestedServiceDates.length >= 2
      ? hashSimulationReturnMatrixRequest(
          canonicalizeSimulationReturnMatrixRequest({
            scenarioUniverseHash,
            requestedServiceDates: preflight.requestedServiceDates,
          }),
        )
      : null;

  return Object.freeze({
    status: matrix.status,
    vectorReviewStatus:
      matrix.status === "ready"
        ? ("eligible_for_scenario_vector_review" as const)
        : ("blocked_until_matrix_ready" as const),
    policy: SIMULATION_RETURN_MATRIX_UNIVERSE_EVIDENCE_POLICY,
    requestedWindow: Object.freeze({
      serviceDateFrom: matrix.requestedServiceDates[0] ?? null,
      serviceDateTo: matrix.requestedServiceDates.at(-1) ?? null,
      requestedServiceDateCount: matrix.requestedServiceDates.length,
      requestedServiceDates: matrix.requestedServiceDates,
    }),
    queryRange: input.queryRange,
    summary: Object.freeze({
      requestedInstrumentCount: matrix.summary.requestedInstrumentCount,
      includedInstrumentCount: matrix.summary.includedInstrumentCount,
      excludedInstrumentCount: matrix.summary.excludedInstrumentCount,
      matrixRowCount: matrix.summary.matrixRowCount,
      readyCellCount: matrix.summary.readyCellCount,
      totalCellCount: matrix.summary.totalCellCount,
      coveragePct: matrix.summary.coveragePct,
      acceptedPriceRows: matrix.sourceSummary.acceptedPriceRows,
      acceptedFxRows: matrix.sourceSummary.acceptedFxRows,
    }),
    instruments: Object.freeze(instruments),
    exclusions: matrix.exclusions,
    blockers: matrix.blockers,
    scenarioUniverseHash,
    matrixRequestHash,
  });
}

export function canonicalizeSimulationScenarioUniverse(input: {
  instruments: readonly SimulationReturnMatrixInstrument[];
}) {
  return JSON.stringify({
    hashVersion:
      SIMULATION_RETURN_MATRIX_UNIVERSE_EVIDENCE_POLICY
        .scenarioUniverseHashVersion,
    identityPolicyVersion:
      SIMULATION_RETURN_MATRIX_UNIVERSE_EVIDENCE_POLICY
        .identityPolicyVersion,
    basisPolicy:
      SIMULATION_RETURN_MATRIX_UNIVERSE_EVIDENCE_POLICY.basisPolicy,
    instruments: [...input.instruments]
      .sort((left, right) =>
        left.instrumentKey.localeCompare(right.instrumentKey),
      )
      .map((row) => ({
        market: row.market,
        currency: row.currency,
        ticker: row.ticker,
      })),
  });
}

export function hashSimulationScenarioUniverse(serialized: string) {
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

export function canonicalizeSimulationReturnMatrixRequest(input: {
  scenarioUniverseHash: string;
  requestedServiceDates: readonly string[];
}) {
  return JSON.stringify({
    hashVersion:
      SIMULATION_RETURN_MATRIX_UNIVERSE_EVIDENCE_POLICY
        .matrixRequestHashVersion,
    evidencePolicyVersion:
      SIMULATION_RETURN_MATRIX_UNIVERSE_EVIDENCE_POLICY.version,
    returnMatrixPolicyVersion:
      SIMULATION_RETURN_MATRIX_UNIVERSE_EVIDENCE_POLICY
        .returnMatrixPolicyVersion,
    scenarioUniverseHash: input.scenarioUniverseHash,
    requestedServiceDates: [...input.requestedServiceDates],
  });
}

export function hashSimulationReturnMatrixRequest(serialized: string) {
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

function buildRequestPreflight(
  request: SimulationReturnMatrixUniverseRequest,
) {
  return buildSimulationReturnMatrix({
    requestedServiceDates: request.requestedServiceDates,
    instruments: request.instruments.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      historyStatus: "instrument_keyed" as const,
    })),
    priceRows: [],
    fxRows: [],
  });
}

function isScenarioUniverseHashable(
  preflight: ReturnType<typeof buildRequestPreflight>,
) {
  return (
    preflight.instruments.length > 0 &&
    preflight.exclusions.length === 0 &&
    preflight.summary.requestedInstrumentCount ===
      preflight.instruments.length &&
    !preflight.blockers.some(
      (blocker) =>
        blocker.reason === "duplicate_instrument" ||
        blocker.reason === "invalid_instrument_history_status",
    )
  );
}

function summarizeObservationCoverage({
  serviceDates,
  observations,
  maxCarryDays,
  missingReason,
  staleReason,
}: {
  serviceDates: readonly string[];
  observations: readonly (
    | SimulationPriceObservation
    | SimulationFxObservation
  )[];
  maxCarryDays: number;
  missingReason: "missing_price" | "missing_fx";
  staleReason: "stale_price" | "stale_fx";
}) {
  let coveredServiceDateCount = 0;
  const reasons = new Set<string>();
  for (const serviceDate of serviceDates) {
    const selected = latestRiskObservationOnOrBefore(
      observations,
      serviceDate,
    );
    if (!selected) {
      reasons.add(missingReason);
    } else if (selected.carryDays > maxCarryDays) {
      reasons.add(staleReason);
    } else {
      coveredServiceDateCount += 1;
    }
  }

  return Object.freeze({
    status: "required" as const,
    requiredServiceDateCount: serviceDates.length,
    coveredServiceDateCount,
    coveragePct: percentage(coveredServiceDateCount, serviceDates.length),
    observedSourceDateFrom: observations[0]?.sourceDate ?? null,
    observedSourceDateTo: observations.at(-1)?.sourceDate ?? null,
    reasons: Object.freeze([...reasons].sort()),
  });
}

function displayNamesByInstrumentKey(
  instruments: readonly SimulationReturnMatrixUniverseCandidate[],
) {
  const rows = new Map<string, string | null>();
  for (const instrument of instruments) {
    const market = normalizeText(instrument.market)?.toLowerCase();
    const currency = normalizeText(instrument.currency)?.toUpperCase();
    const ticker = normalizeText(instrument.ticker)?.toUpperCase();
    if (!market || !currency || !ticker) continue;
    const key = `${market}|${currency}|${ticker}`;
    if (!rows.has(key)) {
      rows.set(key, normalizeText(instrument.displayName));
    }
  }
  return rows;
}

function normalizeText(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}
