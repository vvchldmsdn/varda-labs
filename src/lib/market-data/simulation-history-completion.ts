import { KIS_RAW_HISTORY_POLICY } from "./providers/kis-history.ts";
import type { PriceLookupTarget } from "./providers/types.ts";

const TRACKED_ACCOUNT_CODES = new Set(["brokerage", "isa", "irp"]);

export const SIMULATION_HISTORY_COMPLETION_POLICY = Object.freeze({
  version: "simulation_history_completion_v1",
  sharedReferenceData: true,
  targetAccounts: Object.freeze(["brokerage", "isa", "irp"]),
  supportedMarketCurrencies: Object.freeze(["korea|KRW", "us|USD"]),
  maximumRangeCalendarDays: 180,
  maximumBatchSize: KIS_RAW_HISTORY_POLICY.maximumInstrumentCount,
  providerRetryCount: 0,
  missingIdentityHandling: "exclude_and_report",
} as const);

export type SimulationHistoryHoldingInput = Readonly<{
  accountCode: string;
  market: string | null;
  currency: string | null;
  ticker: string | null;
  quantity: string | number | null;
}>;

export type SimulationHistoryCompletionPlan = Readonly<{
  status: "ready";
  policy: typeof SIMULATION_HISTORY_COMPLETION_POLICY;
  startDate: string;
  endDate: string;
  rangeCalendarDays: number;
  holdingCount: number;
  selectedHoldingCount: number;
  excludedHoldingCount: number;
  excludedByReason: Readonly<Record<string, number>>;
  targets: readonly Readonly<PriceLookupTarget>[];
  batches: readonly (readonly Readonly<PriceLookupTarget>[])[];
}>;

export class SimulationHistoryCompletionInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationHistoryCompletionInputError";
  }
}

export function planSimulationHistoryCompletion(input: {
  startDate: string;
  endDate: string;
  holdings: readonly SimulationHistoryHoldingInput[];
}): SimulationHistoryCompletionPlan {
  const startDate = parseDateKey(input.startDate);
  const endDate = parseDateKey(input.endDate);
  if (!startDate || !endDate || startDate > endDate) {
    throw new SimulationHistoryCompletionInputError(
      "simulation history completion requires valid YYYY-MM-DD dates with startDate <= endDate",
    );
  }

  const rangeCalendarDays = differenceInCalendarDays(startDate, endDate) + 1;
  if (
    rangeCalendarDays >
    SIMULATION_HISTORY_COMPLETION_POLICY.maximumRangeCalendarDays
  ) {
    throw new SimulationHistoryCompletionInputError(
      `simulation history completion is limited to ${SIMULATION_HISTORY_COMPLETION_POLICY.maximumRangeCalendarDays} calendar days`,
    );
  }

  const excludedByReason = new Map<string, number>();
  const targetsByKey = new Map<string, MutableTarget>();
  let selectedHoldingCount = 0;

  for (const holding of input.holdings) {
    const accountCode = normalizeText(holding.accountCode)?.toLowerCase();
    const quantity = Number(holding.quantity);
    if (!accountCode || !TRACKED_ACCOUNT_CODES.has(accountCode)) {
      increment(excludedByReason, "account_not_supported");
      continue;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      increment(excludedByReason, "quantity_not_positive");
      continue;
    }

    const market = normalizeText(holding.market)?.toLowerCase() ?? null;
    const currency = normalizeText(holding.currency)?.toUpperCase() ?? null;
    const ticker = normalizeText(holding.ticker)?.toUpperCase() ?? null;
    if (!ticker) {
      increment(excludedByReason, "ticker_missing");
      continue;
    }
    if (!/^[A-Z0-9._-]{1,50}$/.test(ticker)) {
      increment(excludedByReason, "ticker_invalid");
      continue;
    }
    if (
      !market ||
      !currency ||
      !(
        (market === "korea" && currency === "KRW") ||
        (market === "us" && currency === "USD")
      )
    ) {
      increment(excludedByReason, "market_currency_not_supported");
      continue;
    }

    selectedHoldingCount += 1;
    const key = `${market}|${currency}|${ticker}`;
    const target = targetsByKey.get(key) ?? {
      key,
      ticker,
      market,
      currency,
    };
    targetsByKey.set(key, target);
  }

  const targets = [...targetsByKey.values()]
    .sort((left, right) => left.key.localeCompare(right.key))
    .map((target) =>
      Object.freeze({
        key: target.key,
        ticker: target.ticker,
        market: target.market,
        currency: target.currency,
        accounts: [],
        assetIds: [],
        assetNames: [],
      }),
    );
  if (targets.length === 0) {
    throw new SimulationHistoryCompletionInputError(
      "simulation history completion found no supported active holding targets",
    );
  }

  return Object.freeze({
    status: "ready",
    policy: SIMULATION_HISTORY_COMPLETION_POLICY,
    startDate,
    endDate,
    rangeCalendarDays,
    holdingCount: input.holdings.length,
    selectedHoldingCount,
    excludedHoldingCount: input.holdings.length - selectedHoldingCount,
    excludedByReason: Object.freeze(
      Object.fromEntries([...excludedByReason.entries()].sort()),
    ),
    targets: Object.freeze(targets),
    batches: Object.freeze(
      chunk(targets, SIMULATION_HISTORY_COMPLETION_POLICY.maximumBatchSize).map(
        (batch) => Object.freeze(batch),
      ),
    ),
  });
}

type MutableTarget = {
  key: string;
  ticker: string;
  market: string;
  currency: string;
};

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function chunk<T>(values: readonly T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function normalizeText(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function parseDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : value;
}

function differenceInCalendarDays(startDate: string, endDate: string) {
  return Math.round(
    (Date.parse(`${endDate}T00:00:00.000Z`) -
      Date.parse(`${startDate}T00:00:00.000Z`)) /
      86_400_000,
  );
}
