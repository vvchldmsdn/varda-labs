import type {
  PortfolioStructureExclusion,
  PortfolioStructureHoldingRow,
} from "./portfolio-structure.ts";
import type { InvestmentLabEtfXrayMasterInput } from "./investment-lab-etf-xray-types.ts";

export type ResolvedInvestmentLabEtfCandidate = {
  candidateKey: string;
  instrumentKey: string | null;
  name: string;
  ticker: string | null;
  accounts: Set<string>;
  market: string;
  currency: string;
  currentValueKrw: number;
  valuedSubsetWeightPct: number;
  masterMatches: InvestmentLabEtfXrayMasterInput[];
};

export function selectInvestmentLabEtfXrayMasterIds(input: {
  portfolioHoldings: readonly PortfolioStructureHoldingRow[];
  masters: readonly InvestmentLabEtfXrayMasterInput[];
}) {
  const candidates = resolveInvestmentLabEtfCandidates(
    input.portfolioHoldings,
    input.masters,
  );

  return Object.freeze(
    [
      ...new Set(
        candidates.flatMap((candidate) =>
          candidate.masterMatches.length === 1
            ? [candidate.masterMatches[0].referenceId]
            : [],
        ),
      ),
    ].sort(),
  );
}

export function resolveInvestmentLabEtfCandidates(
  portfolioHoldings: readonly PortfolioStructureHoldingRow[],
  masters: readonly InvestmentLabEtfXrayMasterInput[],
) {
  const mastersByInstrument = indexMastersByInstrument(masters);

  const candidatesByKey = new Map<
    string,
    ResolvedInvestmentLabEtfCandidate
  >();
  portfolioHoldings.forEach((holding, index) => {
    const key = instrumentIdentityKey(
      holding.market,
      holding.currency,
      holding.ticker,
    );
    const masterMatches = key ? (mastersByInstrument.get(key) ?? []) : [];
    const explicitEtf = holding.assetType?.trim().toLowerCase() === "etf";
    if (!explicitEtf && masterMatches.length === 0) return;

    const candidateKey =
      key ??
      [
        "unresolved",
        canonicalLower(holding.market) ?? "",
        canonicalUpper(holding.currency) ?? "",
        canonicalUpper(holding.name) ?? String(index),
      ].join("|");
    const existing = candidatesByKey.get(candidateKey);
    if (existing) {
      existing.accounts.add(holding.account);
      existing.currentValueKrw += finiteOrZero(holding.currentValueKrw);
      existing.valuedSubsetWeightPct += finiteOrZero(holding.currentWeightPct);
      return;
    }

    candidatesByKey.set(candidateKey, {
      candidateKey,
      instrumentKey: key,
      name: cleanText(holding.name) ?? "Unnamed ETF",
      ticker: canonicalUpper(holding.ticker),
      accounts: new Set([holding.account]),
      market: canonicalLower(holding.market) ?? "unknown",
      currency: canonicalUpper(holding.currency) ?? "unknown",
      currentValueKrw: finiteOrZero(holding.currentValueKrw),
      valuedSubsetWeightPct: finiteOrZero(holding.currentWeightPct),
      masterMatches,
    });
  });

  return [...candidatesByKey.values()].sort(
    (left, right) =>
      right.valuedSubsetWeightPct - left.valuedSubsetWeightPct ||
      left.name.localeCompare(right.name),
  );
}

export function countExcludedInvestmentLabEtfHoldings(
  exclusions: readonly PortfolioStructureExclusion[],
  masters: readonly InvestmentLabEtfXrayMasterInput[],
) {
  const mastersByInstrument = indexMastersByInstrument(masters);
  return exclusions.filter((exclusion) => {
    if (exclusion.assetType?.trim().toLowerCase() === "etf") return true;
    const key = instrumentIdentityKey(
      exclusion.market,
      exclusion.currency,
      exclusion.ticker,
    );
    return key ? (mastersByInstrument.get(key)?.length ?? 0) > 0 : false;
  }).length;
}

export function buildDirectPortfolioWeights(
  holdings: readonly PortfolioStructureHoldingRow[],
) {
  const result = new Map<string, number>();
  for (const holding of holdings) {
    const key = instrumentIdentityKey(
      holding.market,
      holding.currency,
      holding.ticker,
    );
    if (!key) continue;
    result.set(
      key,
      (result.get(key) ?? 0) + finiteOrZero(holding.currentWeightPct),
    );
  }
  return result;
}

export function instrumentIdentityKey(
  market: string | null | undefined,
  currency: string | null | undefined,
  ticker: string | null | undefined,
) {
  const normalizedMarket = canonicalLower(market);
  const normalizedCurrency = canonicalUpper(currency);
  const normalizedTicker = canonicalUpper(ticker);
  if (!normalizedMarket || !normalizedCurrency || !normalizedTicker) return null;
  return `${normalizedMarket}|${normalizedCurrency}|${normalizedTicker}`;
}

function indexMastersByInstrument(
  masters: readonly InvestmentLabEtfXrayMasterInput[],
) {
  const result = new Map<string, InvestmentLabEtfXrayMasterInput[]>();
  for (const master of masters) {
    const key = instrumentIdentityKey(
      master.market,
      master.currency,
      master.ticker,
    );
    if (!key) continue;
    const existing = result.get(key);
    if (existing) existing.push(master);
    else result.set(key, [master]);
  }
  return result;
}

function canonicalUpper(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.toUpperCase() : null;
}

function canonicalLower(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized.toLowerCase() : null;
}

function cleanText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || null;
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0;
}
