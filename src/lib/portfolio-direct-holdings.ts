import type {
  PortfolioStructureHoldingRow,
  PortfolioStructureResult,
} from "./portfolio-structure.ts";
import { normalizeTicker } from "./portfolio-math.ts";

export const PORTFOLIO_DIRECT_HOLDINGS_BASELINE_POLICY = Object.freeze({
  version: "direct_holdings_concentration_currency_v2",
  accountIdentity: "account_market_currency_ticker",
  allAccountExposureIdentity: "market_currency_ticker",
  valuationBasis: "current_portfolio_structure_read_model",
  lookThrough: "excluded",
  targetRecommendationOrOrderAuthority: "excluded",
} as const);

export type PortfolioDirectHolding = Readonly<{
  key: string;
  account: string;
  name: string;
  ticker: string;
  market: string;
  currency: string;
  currentValueKrw: number;
  currentWeightPct: number;
}>;

export type PortfolioDirectHoldingCurrencyExposure = Readonly<{
  currency: string;
  currentValueKrw: number;
  currentWeightPct: number;
}>;

export type PortfolioDirectHoldingMetrics = Readonly<{
  totalValueKrw: number;
  largestHoldingWeightPct: number;
  topThreeWeightPct: number;
  hhiPoints: number;
  effectiveHoldingCount: number;
  currencyExposures: readonly PortfolioDirectHoldingCurrencyExposure[];
}>;

export type PortfolioDirectHoldingsAnalysis = Readonly<{
  holdings: readonly PortfolioDirectHolding[];
  resolvedInputHoldingCount: number;
  unresolvedIdentityCount: number;
  invalidValueCount: number;
  metrics: PortfolioDirectHoldingMetrics | null;
}>;

export type PortfolioDirectHoldingIdentityScope =
  | "account_scoped"
  | "cross_account_exposure";

export type PortfolioDirectHoldingsBaseline = Readonly<{
  policy: typeof PORTFOLIO_DIRECT_HOLDINGS_BASELINE_POLICY;
  selectedAccount: PortfolioStructureResult["selectedAccount"];
  status: "complete" | "partial" | "unavailable";
  inputHoldingCount: number;
  directHoldingCount: number;
  resolvedInputHoldingCount: number;
  excludedHoldingCount: number;
  unresolvedIdentityCount: number;
  invalidValueCount: number;
  metrics: PortfolioDirectHoldingMetrics | null;
  largestHolding: PortfolioDirectHolding | null;
}>;

type DirectHoldingInput = Pick<
  PortfolioStructureHoldingRow,
  "account" | "name" | "ticker" | "market" | "currency" | "currentValueKrw"
>;

export function analyzePortfolioDirectHoldings(
  rows: readonly DirectHoldingInput[],
  {
    identityScope = "account_scoped",
  }: { identityScope?: PortfolioDirectHoldingIdentityScope } = {},
): PortfolioDirectHoldingsAnalysis {
  const grouped = new Map<
    string,
    Omit<PortfolioDirectHolding, "currentWeightPct">
  >();
  let resolvedInputHoldingCount = 0;
  let unresolvedIdentityCount = 0;
  let invalidValueCount = 0;

  for (const row of rows) {
    if (!isValidNonnegativeValue(row.currentValueKrw)) {
      invalidValueCount += 1;
      continue;
    }

    const identity = canonicalDirectHoldingIdentity(row, identityScope);
    if (!identity) {
      unresolvedIdentityCount += 1;
      continue;
    }

    resolvedInputHoldingCount += 1;
    const existing = grouped.get(identity.key);
    if (existing) {
      const combinedValueKrw = existing.currentValueKrw + row.currentValueKrw;
      if (!isValidNonnegativeValue(combinedValueKrw)) {
        invalidValueCount += 1;
        resolvedInputHoldingCount -= 1;
        continue;
      }
      grouped.set(identity.key, {
        ...existing,
        name: stableDisplayName(existing.name, row.name, identity.ticker),
        currentValueKrw: combinedValueKrw,
      });
      continue;
    }

    grouped.set(identity.key, {
      ...identity,
      name: row.name.trim() || identity.ticker,
      currentValueKrw: row.currentValueKrw,
    });
  }

  const unweightedHoldings = [...grouped.values()];
  const metrics = calculatePortfolioDirectHoldingMetrics(unweightedHoldings);
  const holdings = metrics
    ? unweightedHoldings
        .map((row) =>
          Object.freeze({
            ...row,
            currentWeightPct: percentage(
              row.currentValueKrw,
              metrics.totalValueKrw,
            ),
          }),
        )
        .sort(compareDirectHoldings)
    : [];

  return Object.freeze({
    holdings: Object.freeze(holdings),
    resolvedInputHoldingCount,
    unresolvedIdentityCount,
    invalidValueCount,
    metrics,
  });
}

export function buildPortfolioDirectHoldingsBaseline(
  portfolio: Pick<
    PortfolioStructureResult,
    "selectedAccount" | "holdingRows" | "exclusions"
  >,
): PortfolioDirectHoldingsBaseline {
  const analysis = analyzePortfolioDirectHoldings(portfolio.holdingRows, {
    identityScope:
      portfolio.selectedAccount === "all"
        ? "cross_account_exposure"
        : "account_scoped",
  });
  const excludedHoldingCount = portfolio.exclusions.length;
  const hasIncompleteEvidence =
    excludedHoldingCount > 0 ||
    analysis.unresolvedIdentityCount > 0 ||
    analysis.invalidValueCount > 0;
  const status = !analysis.metrics
    ? "unavailable"
    : hasIncompleteEvidence
      ? "partial"
      : "complete";

  return Object.freeze({
    policy: PORTFOLIO_DIRECT_HOLDINGS_BASELINE_POLICY,
    selectedAccount: portfolio.selectedAccount,
    status,
    inputHoldingCount: portfolio.holdingRows.length + excludedHoldingCount,
    directHoldingCount: analysis.holdings.length,
    resolvedInputHoldingCount: analysis.resolvedInputHoldingCount,
    excludedHoldingCount,
    unresolvedIdentityCount: analysis.unresolvedIdentityCount,
    invalidValueCount: analysis.invalidValueCount,
    metrics: analysis.metrics,
    largestHolding: analysis.holdings[0] ?? null,
  });
}

export function calculatePortfolioDirectHoldingMetrics(
  holdings: readonly Pick<
    PortfolioDirectHolding,
    "currency" | "currentValueKrw"
  >[],
): PortfolioDirectHoldingMetrics | null {
  if (
    holdings.length === 0 ||
    holdings.some((row) => !isValidNonnegativeValue(row.currentValueKrw))
  ) {
    return null;
  }

  const totalValueKrw = holdings.reduce(
    (total, row) => total + row.currentValueKrw,
    0,
  );
  if (!isValidPositiveTotal(totalValueKrw)) return null;

  let largestHoldingWeightPct = 0;
  let sumSquaredWeights = 0;
  const currencyValues = new Map<string, number>();
  const holdingWeights = holdings.map((holding) => {
    const weight = holding.currentValueKrw / totalValueKrw;
    largestHoldingWeightPct = Math.max(largestHoldingWeightPct, weight * 100);
    sumSquaredWeights += weight * weight;
    currencyValues.set(
      holding.currency,
      (currencyValues.get(holding.currency) ?? 0) + holding.currentValueKrw,
    );
    return weight;
  });
  if (!Number.isFinite(sumSquaredWeights) || sumSquaredWeights <= 0) {
    return null;
  }

  const topThreeWeightPct = [...holdingWeights]
    .sort((left, right) => right - left)
    .slice(0, 3)
    .reduce((total, weight) => total + weight * 100, 0);
  const currencyExposures = [...currencyValues]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, currentValueKrw]) =>
      Object.freeze({
        currency,
        currentValueKrw,
        currentWeightPct: percentage(currentValueKrw, totalValueKrw),
      }),
    );

  return Object.freeze({
    totalValueKrw,
    largestHoldingWeightPct,
    topThreeWeightPct,
    hhiPoints: sumSquaredWeights * 10_000,
    effectiveHoldingCount: 1 / sumSquaredWeights,
    currencyExposures: Object.freeze(currencyExposures),
  });
}

export function hasCanonicalPortfolioInstrumentIdentity(
  row: Pick<DirectHoldingInput, "account" | "market" | "currency" | "ticker">,
) {
  return canonicalDirectHoldingIdentity(row, "account_scoped") !== null;
}

function canonicalDirectHoldingIdentity(
  row: Pick<DirectHoldingInput, "account" | "market" | "currency" | "ticker">,
  identityScope: PortfolioDirectHoldingIdentityScope,
) {
  const account = row.account.trim().toLowerCase();
  const market = row.market.trim().toLowerCase();
  const currency = row.currency.trim().toUpperCase();
  const ticker = normalizeTicker(row.ticker);
  if (
    !account ||
    !market ||
    !currency ||
    currency === "UNKNOWN" ||
    !ticker
  ) {
    return null;
  }

  return {
    key: [
      ...(identityScope === "account_scoped" ? [account] : []),
      market,
      currency,
      ticker,
    ]
      .map((part) => encodeURIComponent(part))
      .join("|"),
    account: identityScope === "account_scoped" ? account : "all",
    market,
    currency,
    ticker,
  };
}

function stableDisplayName(current: string, candidate: string, ticker: string) {
  const normalizedCandidate = candidate.trim() || ticker;
  return current.localeCompare(normalizedCandidate) <= 0
    ? current
    : normalizedCandidate;
}

function compareDirectHoldings(
  left: PortfolioDirectHolding,
  right: PortfolioDirectHolding,
) {
  return (
    right.currentValueKrw - left.currentValueKrw ||
    left.key.localeCompare(right.key)
  );
}

function percentage(value: number, total: number) {
  return total > 0 ? (value / total) * 100 : 0;
}

function isValidNonnegativeValue(value: number) {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}

function isValidPositiveTotal(value: number) {
  return (
    Number.isFinite(value) &&
    value > 0 &&
    value <= Number.MAX_SAFE_INTEGER
  );
}
