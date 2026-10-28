import { applyInvestmentLabCurrentHoldingScope } from "./investment-lab-current-holding-scope.ts";
import { allocateBasisPointsByValue } from "./basis-point-allocation.ts";
import {
  DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS,
  resolveInvestmentLabSpecialHoldingIdentity,
} from "./investment-lab-special-holding-authority.ts";
import type { PortfolioAnalysisScopeKey } from "./portfolio-analysis-scope.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";
import type {
  PortfolioStructureExclusion,
  PortfolioStructureHoldingRow,
  PortfolioStructureResult,
} from "./portfolio-structure.ts";
import type { PortfolioHoldingClassification } from "./portfolio-special-holdings.ts";
import {
  SIMULATION_RESEARCH_UNIVERSE_SPECIAL_IDENTITIES,
  type SimulationResearchUniverseInstrument,
  type SimulationResearchUniverseSelection,
} from "./simulation-research-universe-preflight-policy.ts";

export const SIMULATION_OWNER_INPUT_PREFLIGHT_POLICY = Object.freeze({
  version: "simulation_owner_input_preflight_v1",
  sourceKindCandidate: "observed_current_baseline",
  ownerAuthority: "resolved_server_tenant_context",
  accountAuthority: "bounded_server_validated_query_filter",
  analysisScopeAuthority:
    "owner_scoped_catalog_and_effective_dated_membership",
  valuationBasis: "owner_scoped_current_portfolio_display_evidence",
  weightDerivation: "largest_remainder_display_value_diagnostics_v1",
  maximumInstrumentCount: 64,
  fountPolicy: "intentionally_excluded_before_weight_derivation",
  krxGoldPolicy: "preserve_weight_and_require_manual_history",
  missingValuationPolicy: "block_vector_preserve_diagnostics",
  runtimeTrustStatus: "not_established",
  executionStatus: "not_ready",
  providerCalls: "forbidden",
  databaseWrites: "forbidden",
} as const);

type CandidateBlocker =
  | "account_scope_mismatch"
  | "empty_positive_portfolio"
  | "valuation_evidence_incomplete"
  | "instrument_identity_unresolved"
  | "instrument_limit_exceeded"
  | "weight_derivation_failed";

type OwnerInstrumentRow = Readonly<{
  instrumentKey: string;
  market: string;
  currency: "KRW" | "USD";
  ticker: string;
  name: string;
  accounts: readonly string[];
  classification: PortfolioHoldingClassification;
  currentValueKrw: number;
  weightBps: number | null;
}>;

type OwnerValuationGap = Readonly<{
  name: string;
  account: string;
  market: string;
  currency: string;
  ticker: string | null;
  reason: PortfolioStructureExclusion["reason"];
}>;

type OwnerIdentityGap = Readonly<{
  name: string;
  account: string;
  market: string;
  currency: string;
  ticker: string | null;
  currentValueKrw: number;
}>;

export type SimulationOwnerInputCandidate = Readonly<{
  account: SimulationOwnerScopeKey;
  status: "ready_for_historical_preflight" | "diagnostics_only";
  policy: typeof SIMULATION_OWNER_INPUT_PREFLIGHT_POLICY;
  runtimeTrustStatus: "not_established";
  executionStatus: "not_ready";
  selection: SimulationResearchUniverseSelection | null;
  instruments: readonly OwnerInstrumentRow[];
  identityGaps: readonly OwnerIdentityGap[];
  valuationGaps: readonly OwnerValuationGap[];
  blockers: readonly CandidateBlocker[];
  summary: Readonly<{
    sourceHoldingCount: number;
    aggregatedInstrumentCount: number;
    positiveHoldingCount: number;
    nonPositiveHoldingCount: number;
    fountExcludedHoldingCount: number;
    fountExcludedValuationGapCount: number;
    fountExcludedCurrentValueKrw: number;
    valuationGapCount: number;
    identityGapCount: number;
    currentValueKrw: number;
    totalWeightBps: number;
  }>;
}>;

export type SimulationOwnerScopeKey =
  | PortfolioAccountScope
  | PortfolioAnalysisScopeKey;

type SimulationOwnerInputCandidateInput =
  | Readonly<{
      account: PortfolioAccountScope;
      portfolio: PortfolioStructureResult;
    }>
  | Readonly<{
      scopeKey: PortfolioAnalysisScopeKey;
      portfolio: PortfolioStructureResult;
    }>;

export function buildSimulationOwnerInputCandidate(
  input: SimulationOwnerInputCandidateInput,
): SimulationOwnerInputCandidate {
  const scopeKey = "scopeKey" in input ? input.scopeKey : input.account;
  const blockers = new Set<CandidateBlocker>();
  if (
    "account" in input &&
    input.portfolio.selectedAccount !== input.account
  ) {
    blockers.add("account_scope_mismatch");
  }

  const scoped = applyInvestmentLabCurrentHoldingScope(input.portfolio);
  const positiveHoldings = scoped.portfolio.holdingRows.filter(
    (row) => Number.isFinite(row.currentValueKrw) && row.currentValueKrw > 0,
  );
  const nonPositiveHoldingCount =
    scoped.portfolio.holdingRows.length - positiveHoldings.length;
  const valuationGaps = scoped.portfolio.exclusions.map(toValuationGap);
  if (valuationGaps.length > 0) {
    blockers.add("valuation_evidence_incomplete");
  }

  const aggregated = aggregateOwnerHoldings(positiveHoldings);
  if (aggregated.identityGaps.length > 0) {
    blockers.add("instrument_identity_unresolved");
  }
  if (aggregated.rows.length === 0) {
    blockers.add("empty_positive_portfolio");
  }
  if (
    aggregated.rows.length >
    SIMULATION_OWNER_INPUT_PREFLIGHT_POLICY.maximumInstrumentCount
  ) {
    blockers.add("instrument_limit_exceeded");
  }

  const canDeriveWeights = blockers.size === 0;
  const weightRows = canDeriveWeights
    ? allocateBasisPointsByValue(
        aggregated.rows.map((row) => ({
          key: row.instrumentKey,
          value: row.currentValueKrw,
        })),
      )
    : null;
  if (canDeriveWeights && weightRows === null) {
    blockers.add("weight_derivation_failed");
  }

  const instruments = aggregated.rows.map((row) =>
    Object.freeze({
      ...row,
      weightBps: weightRows?.get(row.instrumentKey) ?? null,
    }),
  );
  const selection =
    blockers.size === 0 ? buildServerSelection(instruments) : null;
  if (blockers.size === 0 && selection === null) {
    blockers.add("weight_derivation_failed");
  }

  const totalWeightBps = instruments.reduce(
    (sum, row) => sum + (row.weightBps ?? 0),
    0,
  );
  const currentValueKrw = instruments.reduce(
    (sum, row) => sum + row.currentValueKrw,
    0,
  );

  return Object.freeze({
    account: scopeKey,
    status:
      blockers.size === 0 && selection
        ? "ready_for_historical_preflight"
        : "diagnostics_only",
    policy: SIMULATION_OWNER_INPUT_PREFLIGHT_POLICY,
    runtimeTrustStatus: "not_established",
    executionStatus: "not_ready",
    selection,
    instruments: Object.freeze(instruments),
    identityGaps: aggregated.identityGaps,
    valuationGaps: Object.freeze(valuationGaps),
    blockers: Object.freeze([...blockers].sort()),
    summary: Object.freeze({
      sourceHoldingCount: input.portfolio.holdingRows.length,
      aggregatedInstrumentCount: instruments.length,
      positiveHoldingCount: positiveHoldings.length,
      nonPositiveHoldingCount,
      fountExcludedHoldingCount: scoped.excludedHoldingCount,
      fountExcludedValuationGapCount: scoped.excludedValuationGapCount,
      fountExcludedCurrentValueKrw: scoped.excludedCurrentValueKrw,
      valuationGapCount: valuationGaps.length,
      identityGapCount: aggregated.identityGaps.length,
      currentValueKrw,
      totalWeightBps,
    }),
  });
}

function aggregateOwnerHoldings(rows: readonly PortfolioStructureHoldingRow[]) {
  const byKey = new Map<
    string,
    {
      instrumentKey: string;
      market: string;
      currency: "KRW" | "USD";
      ticker: string;
      classification: PortfolioHoldingClassification;
      names: Set<string>;
      accounts: Set<string>;
      currentValueKrw: number;
    }
  >();
  const identityGaps: OwnerIdentityGap[] = [];

  for (const row of rows) {
    const identity = resolveOwnerInstrumentIdentity(row);
    if (!identity) {
      identityGaps.push(
        Object.freeze({
          name: row.name,
          account: row.account,
          market: row.market,
          currency: row.currency,
          ticker: row.ticker,
          currentValueKrw: row.currentValueKrw,
        }),
      );
      continue;
    }
    const aggregate = byKey.get(identity.instrumentKey) ?? {
      ...identity,
      names: new Set<string>(),
      accounts: new Set<string>(),
      currentValueKrw: 0,
    };
    aggregate.names.add(row.name.trim() || identity.ticker);
    aggregate.accounts.add(row.account);
    aggregate.currentValueKrw += row.currentValueKrw;
    byKey.set(identity.instrumentKey, aggregate);
  }

  return Object.freeze({
    identityGaps: Object.freeze(identityGaps),
    rows: Object.freeze(
      [...byKey.values()]
        .sort((left, right) =>
          left.instrumentKey.localeCompare(right.instrumentKey),
        )
        .map((row) =>
          Object.freeze({
            instrumentKey: row.instrumentKey,
            market: row.market,
            currency: row.currency,
            ticker: row.ticker,
            name: [...row.names].sort().join(" / "),
            accounts: Object.freeze([...row.accounts].sort()),
            classification: row.classification,
            currentValueKrw: row.currentValueKrw,
          }),
        ),
    ),
  });
}

function resolveOwnerInstrumentIdentity(row: PortfolioStructureHoldingRow) {
  if (matchesApprovedSpecialHolding(row, "krxGold")) {
    const gold = SIMULATION_RESEARCH_UNIVERSE_SPECIAL_IDENTITIES.krxGold;
    return Object.freeze({
      instrumentKey: `${gold.market}|${gold.currency}|${gold.ticker}`,
      market: gold.market,
      currency: gold.currency,
      ticker: gold.ticker,
      classification: gold.classification,
    });
  }

  const resolved = resolveInvestmentLabSpecialHoldingIdentity({
    ticker: row.ticker,
    assetName: row.name,
    account: row.account,
    source: row.priceSource,
    market: row.market,
    currency: row.currency,
    assetType: row.assetType,
  });
  const market = row.market.trim().toLowerCase();
  const currency = row.currency.trim().toUpperCase();
  const ticker = resolved.ticker?.trim().toUpperCase() ?? null;

  if (
    ticker &&
    isCanonicalMarket(market) &&
    (currency === "KRW" || currency === "USD") &&
    isCanonicalTicker(ticker)
  ) {
    return Object.freeze({
      instrumentKey: `${market}|${currency}|${ticker}`,
      market,
      currency,
      ticker,
      classification: "listed_instrument" as const,
    });
  }

  if (
    resolved.specialHoldingEvidence?.historicalAuthorityOutcome ===
    "manual_valuation_history_required"
  ) {
    const gold = SIMULATION_RESEARCH_UNIVERSE_SPECIAL_IDENTITIES.krxGold;
    return Object.freeze({
      instrumentKey: `${gold.market}|${gold.currency}|${gold.ticker}`,
      market: gold.market,
      currency: gold.currency,
      ticker: gold.ticker,
      classification: gold.classification,
    });
  }

  return null;
}

function matchesApprovedSpecialHolding(
  row: PortfolioStructureHoldingRow,
  decisionKey: "krxGold",
) {
  const decision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions[decisionKey];
  return (
    normalizeLower(row.name) === normalizeLower(decision.assetName) &&
    normalizeLower(row.account) === decision.account &&
    normalizeLower(row.market) === decision.market &&
    row.currency.trim().toUpperCase() === decision.currency &&
    normalizeLower(row.assetType) === decision.assetType
  );
}

function buildServerSelection(
  rows: readonly OwnerInstrumentRow[],
): SimulationResearchUniverseSelection | null {
  const instruments: SimulationResearchUniverseInstrument[] = [];
  let totalWeightBps = 0;
  for (const row of rows) {
    if (row.weightBps === null) return null;
    totalWeightBps += row.weightBps;
    instruments.push(
      Object.freeze({
        instrumentKey: row.instrumentKey,
        market: row.market,
        currency: row.currency,
        ticker: row.ticker,
        weightBps: row.weightBps,
        classification: row.classification,
      }),
    );
  }
  if (totalWeightBps !== 10_000) return null;

  return Object.freeze({
    status: "valid",
    rawValue: "server-derived-owner-composition",
    issues: Object.freeze([]),
    instruments: Object.freeze(instruments),
    totalWeightBps: 10_000,
  });
}

function toValuationGap(row: PortfolioStructureExclusion): OwnerValuationGap {
  return Object.freeze({
    name: row.name,
    account: row.account,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    reason: row.reason,
  });
}

function isCanonicalMarket(value: string) {
  return /^[a-z][a-z0-9_-]{0,19}$/.test(value);
}

function isCanonicalTicker(value: string) {
  return /^[A-Z0-9][A-Z0-9._^-]{0,49}$/.test(value);
}

function normalizeLower(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}
