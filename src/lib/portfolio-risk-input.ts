import {
  attachRiskEndWeights,
  buildRiskReturnRows,
  buildRiskValueRow,
} from "./portfolio-risk-input-alignment.ts";
import {
  aggregateRiskHoldings,
  countInvalidRiskFxRows,
  findRelevantDuplicateRiskFxDates,
  normalizeRiskFxRows,
  normalizeRiskPriceRows,
  uniqueSortedRiskDates,
} from "./portfolio-risk-input-sources.ts";
import type {
  PortfolioRiskFxInput,
  PortfolioRiskHoldingInput,
  PortfolioRiskInputBlocker,
  PortfolioRiskInputPolicy,
  PortfolioRiskInputStatus,
  PortfolioRiskPriceInput,
  PortfolioRiskReturnRow,
  PortfolioRiskValueRow,
} from "./portfolio-risk-input-types.ts";

export type {
  PortfolioRiskFxInput,
  PortfolioRiskHoldingInput,
  PortfolioRiskInputBlocker,
  PortfolioRiskInputExclusion,
  PortfolioRiskInputPolicy,
  PortfolioRiskInputStatus,
  PortfolioRiskPriceInput,
  PortfolioRiskReturnRow,
  PortfolioRiskValueObservation,
  PortfolioRiskValueRow,
} from "./portfolio-risk-input-types.ts";

export const DEFAULT_PORTFOLIO_RISK_INPUT_POLICY: PortfolioRiskInputPolicy = {
  requestedReturnObservations: 90,
  maxPriceCarryDays: 7,
  maxFxCarryDays: 3,
  minimumReturnCoveragePct: 80,
  minimumInstruments: 2,
};

export function buildPortfolioRiskInput({
  holdings,
  priceRows,
  fxRows,
  policy: policyOverrides = {},
}: {
  holdings: readonly PortfolioRiskHoldingInput[];
  priceRows: readonly PortfolioRiskPriceInput[];
  fxRows: readonly PortfolioRiskFxInput[];
  policy?: Partial<PortfolioRiskInputPolicy>;
}) {
  const policy = resolvePolicy(policyOverrides);
  const universe = aggregateRiskHoldings(holdings);
  const instrumentKeys = new Set(
    universe.instruments.map((instrument) => instrument.key),
  );
  const priceInput = normalizeRiskPriceRows(priceRows, instrumentKeys);
  const serviceDates = uniqueSortedRiskDates(
    universe.instruments.flatMap((instrument) =>
      (priceInput.seriesByInstrument.get(instrument.key) ?? []).map(
        (row) => row.serviceDate,
      ),
    ),
  );
  const selectedServiceDates = serviceDates.slice(
    -(policy.requestedReturnObservations + 1),
  );
  const requiresFx = universe.instruments.some(
    (instrument) => instrument.currency === "USD",
  );
  const duplicateFxDates = requiresFx
    ? findRelevantDuplicateRiskFxDates(
        fxRows,
        selectedServiceDates,
        policy.maxFxCarryDays,
      )
    : [];
  const blockers: PortfolioRiskInputBlocker[] = [
    ...priceInput.duplicateGroups.map((group) => ({
      reason: "duplicate_price_date" as const,
      instrumentKey: group.instrumentKey,
      dates: group.dates,
    })),
    ...(duplicateFxDates.length > 0
      ? [
          {
            reason: "duplicate_fx_date" as const,
            dates: duplicateFxDates,
          },
        ]
      : []),
  ];
  const baseResult = buildBaseResult({
    holdings,
    universe,
    serviceDates,
    selectedServiceDates,
    priceInvalidRowCount: priceInput.invalidRowCount,
    fxInvalidRowCount: countInvalidRiskFxRows(fxRows),
    policy,
    blockers,
  });

  if (blockers.length > 0) return blockedResult(baseResult);

  const fxSeries = normalizeRiskFxRows(fxRows);
  const valueRows = selectedServiceDates.map((serviceDate) =>
    buildRiskValueRow({
      serviceDate,
      instruments: universe.instruments,
      seriesByInstrument: priceInput.seriesByInstrument,
      fxSeries,
      policy,
    }),
  );
  const returnRows = buildRiskReturnRows(valueRows);
  const returnCoveragePct = percentage(
    returnRows.length,
    policy.requestedReturnObservations,
  );
  const weightRow = valueRows.findLast((row) => row.complete) ?? null;

  return {
    ...baseResult,
    status: resolveStatus({
      instrumentCount: universe.instruments.length,
      returnCoveragePct,
      policy,
    }),
    instruments: attachRiskEndWeights(baseResult.instruments, weightRow),
    valueRows,
    returnRows,
    usableReturnObservations: returnRows.length,
    returnCoveragePct,
    weightAsOfDate: weightRow?.serviceDate ?? null,
  };
}

function buildBaseResult({
  holdings,
  universe,
  serviceDates,
  selectedServiceDates,
  priceInvalidRowCount,
  fxInvalidRowCount,
  policy,
  blockers,
}: {
  holdings: readonly PortfolioRiskHoldingInput[];
  universe: ReturnType<typeof aggregateRiskHoldings>;
  serviceDates: string[];
  selectedServiceDates: string[];
  priceInvalidRowCount: number;
  fxInvalidRowCount: number;
  policy: PortfolioRiskInputPolicy;
  blockers: PortfolioRiskInputBlocker[];
}) {
  return {
    policy,
    calendarPolicy: "stored_close_evidence_d_plus_1" as const,
    fxPolicy: "historical_usdkrw_bounded_prior_carry" as const,
    selectedHoldingCount: holdings.length,
    eligibleHoldingCount: universe.eligibleHoldingCount,
    exclusions: universe.exclusions,
    instruments: universe.instruments.map((instrument) => ({
      instrumentKey: instrument.key,
      ticker: instrument.ticker,
      names: [...instrument.names].sort(),
      market: instrument.market,
      currency: instrument.currency,
      accounts: [...instrument.accounts].sort(),
      quantity: instrument.quantity,
      endValueKrw: null as number | null,
      weight: null as number | null,
    })),
    totalAvailableServiceDates: serviceDates.length,
    selectedServiceDates,
    firstServiceDate: selectedServiceDates[0] ?? null,
    lastServiceDate: selectedServiceDates.at(-1) ?? null,
    invalidPriceRowCount: priceInvalidRowCount,
    invalidFxRowCount: fxInvalidRowCount,
    blockers,
  };
}

function blockedResult(baseResult: ReturnType<typeof buildBaseResult>) {
  return {
    ...baseResult,
    status: "blocked" as const,
    valueRows: [] as PortfolioRiskValueRow[],
    returnRows: [] as PortfolioRiskReturnRow[],
    usableReturnObservations: 0,
    returnCoveragePct: 0,
    weightAsOfDate: null,
  };
}

function resolveStatus({
  instrumentCount,
  returnCoveragePct,
  policy,
}: {
  instrumentCount: number;
  returnCoveragePct: number;
  policy: PortfolioRiskInputPolicy;
}): Exclude<PortfolioRiskInputStatus, "blocked"> {
  if (instrumentCount < policy.minimumInstruments) {
    return "insufficient_instruments";
  }
  if (returnCoveragePct === 100) return "ready";
  if (returnCoveragePct >= policy.minimumReturnCoveragePct) return "partial";
  return "insufficient_coverage";
}

function resolvePolicy(overrides: Partial<PortfolioRiskInputPolicy>) {
  const policy = {
    ...DEFAULT_PORTFOLIO_RISK_INPUT_POLICY,
    ...overrides,
  };
  assertInteger(policy.requestedReturnObservations, 1, "requestedReturnObservations");
  assertInteger(policy.maxPriceCarryDays, 0, "maxPriceCarryDays");
  assertInteger(policy.maxFxCarryDays, 0, "maxFxCarryDays");
  assertInteger(policy.minimumInstruments, 1, "minimumInstruments");
  if (
    !Number.isFinite(policy.minimumReturnCoveragePct) ||
    policy.minimumReturnCoveragePct < 0 ||
    policy.minimumReturnCoveragePct > 100
  ) {
    throw new RangeError("minimumReturnCoveragePct must be between 0 and 100");
  }
  return policy;
}

function assertInteger(value: number, minimum: number, name: string) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be an integer greater than or equal to ${minimum}`);
  }
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0
    ? Number(((numerator / denominator) * 100).toFixed(2))
    : 0;
}
