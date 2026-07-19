import type { InvestmentLabSourceSnapshotRow } from "./investment-lab-counterfactual-read-model.ts";
import {
  resolveInvestmentLabSpecialHoldingIdentity,
  type InvestmentLabAnchorSpecialHoldingEvidence,
  type InvestmentLabImportedTickerEvidence,
} from "./investment-lab-special-holding-authority.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";
import {
  accountsForPortfolioScope,
  isNamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";
const MAX_INSTRUMENTS = 64;

export const INVESTMENT_LAB_ANCHOR_BASKET_POLICY = Object.freeze({
  version: "anchor_observed_equal_weight_same_flow_v1",
  account: "requested_account_scope",
  anchorAuthority: "exact_stored_portfolio_and_position_source",
  identity:
    "stored_ticker_or_base44_imported_snapshot_consensus_then_market_currency_ticker",
  importedIdentity:
    "same_legacy_identity_and_snapshot_metadata_consensus",
  currentAssetFallback: "forbidden",
  nameInference: "forbidden",
  manualValuation:
    "exact_current_writer_stored_manual_rows_without_historical_backcast",
  anchorAllocation: "equal_weight_once_at_anchor",
  subsequentFlowAllocation: "equal_split_across_anchor_instruments",
  rebalancing: "none",
  unresolvedHoldingHandling: "whole_scenario_unavailable",
  explicitExclusionHandling: "blocked_until_scope_consistent_path_transform",
  maximumInstrumentCount: MAX_INSTRUMENTS,
} as const);

export type InvestmentLabAnchorPositionRow = Readonly<{
  snapshotDate: string;
  assetId?: string | null;
  legacyAssetId?: string | null;
  account: string;
  source: string | null;
  ticker: string | null;
  assetName: string | null;
  market: string | null;
  currency: string | null;
  assetType: string | null;
  quantity: string | number | null;
  marketValueKrw: string | number | null;
  priceSource?: string | null;
  priceBasis?: string | null;
  currentPrice?: string | number | null;
  priceDate?: string | null;
  referenceDate?: string | null;
  capturedAt?: Date | string | null;
  importedTickerEvidence?: InvestmentLabImportedTickerEvidence | null;
}>;

export type InvestmentLabAnchorInstrument = Readonly<{
  key: string;
  valuationModel: "listed_close" | "stored_manual";
  ticker: string | null;
  productKey: string | null;
  label: string;
  market: "korea" | "us";
  currency: "KRW" | "USD";
  sourceRows: number;
  accountCount: number;
  storedMarketValueKrw: number;
}>;

export type InvestmentLabAnchorBlocker =
  | "invalid_service_date_axis"
  | "no_complete_anchor_evidence"
  | "requested_anchor_unavailable"
  | "ambiguous_portfolio_source"
  | "tickerless_anchor_holding"
  | "unsupported_anchor_holding_axis"
  | "physical_anchor_holding"
  | "excluded_holding_scope_transform_required"
  | "invalid_anchor_position_evidence"
  | "duplicate_anchor_identity"
  | "ambiguous_anchor_identity_metadata"
  | "instrument_limit_exceeded";

export type InvestmentLabAnchorSelection = Readonly<{
  status: "ready" | "unavailable";
  policy: typeof INVESTMENT_LAB_ANCHOR_BASKET_POLICY;
  selectedAnchorDate: string | null;
  candidateAnchorDates: readonly string[];
  instruments: readonly InvestmentLabAnchorInstrument[];
  coverage: Readonly<{
    sourcePositionRows: number;
    recognizedPositionRows: number;
    separateModelPositionRows: number;
    excludedPositionRows: number;
    unresolvedPositionRows: number;
    economicInstrumentCount: number;
  }>;
  specialHoldingEvidence: readonly InvestmentLabAnchorSpecialHoldingEvidence[];
  blockers: readonly InvestmentLabAnchorBlocker[];
}>;

export function resolveInvestmentLabAnchorSelection(input: Readonly<{
  account?: PortfolioAccountScope;
  serviceDates: readonly string[];
  snapshotRows: readonly InvestmentLabSourceSnapshotRow[];
  positionRows: readonly InvestmentLabAnchorPositionRow[];
  requestedAnchorDate?: string | null;
}>): InvestmentLabAnchorSelection {
  const accountScope = input.account ?? "all";
  const selectedAccounts = accountsForPortfolioScope(accountScope);
  const blockers = new Set<InvestmentLabAnchorBlocker>();
  const serviceDates = [...input.serviceDates];
  if (!isOrderedDateAxis(serviceDates)) {
    blockers.add("invalid_service_date_axis");
    return unavailable(null, [], [], 0, 0, blockers);
  }

  const sourceByDateAccount = portfolioSourceIndex(input.snapshotRows);
  const positionsByDateAccountSource = positionIndex(input.positionRows);
  const candidateAnchorDates = serviceDates.filter((date) =>
    selectedAccounts.every((account) => {
      const source = sourceByDateAccount.get(date)?.get(account);
      return (
        source !== undefined &&
        source !== null &&
        (positionsByDateAccountSource.get(positionGroupKey(date, account, source))
          ?.length ?? 0) > 0
      );
    }),
  );

  if (candidateAnchorDates.length === 0) {
    blockers.add("no_complete_anchor_evidence");
    return unavailable(null, [], [], 0, 0, blockers);
  }

  const requested = normalizeText(input.requestedAnchorDate);
  const selectedAnchorDate = requested ?? candidateAnchorDates[0];
  if (
    !isRiskDate(selectedAnchorDate) ||
    !candidateAnchorDates.includes(selectedAnchorDate)
  ) {
    blockers.add("requested_anchor_unavailable");
    return unavailable(
      selectedAnchorDate,
      candidateAnchorDates,
      [],
      0,
      0,
      blockers,
    );
  }

  const anchorRows: InvestmentLabAnchorPositionRow[] = [];
  for (const account of selectedAccounts) {
    const source = sourceByDateAccount.get(selectedAnchorDate)?.get(account);
    if (!source) {
      blockers.add("ambiguous_portfolio_source");
      continue;
    }
    anchorRows.push(
      ...(positionsByDateAccountSource.get(
        positionGroupKey(selectedAnchorDate, account, source),
      ) ?? []),
    );
  }

  const grouped = new Map<
    string,
    {
      valuationModel: "listed_close" | "stored_manual";
      ticker: string | null;
      productKey: string | null;
      market: "korea" | "us";
      currency: "KRW" | "USD";
      labels: Set<string>;
      accounts: Set<string>;
      sourceRows: number;
      storedMarketValueKrw: number;
    }
  >();
  const specialHoldingEvidence: InvestmentLabAnchorSpecialHoldingEvidence[] = [];
  let recognizedPositionRows = 0;
  let separateModelPositionRows = 0;
  let admittedSeparateModelPositionRows = 0;
  let excludedPositionRows = 0;

  for (const row of anchorRows) {
    const identity = resolveInvestmentLabSpecialHoldingIdentity(row);
    const ticker = identity.ticker;
    const market = normalizeText(row.market)?.toLowerCase() ?? null;
    const currency = normalizeText(row.currency)?.toUpperCase() ?? null;
    const axis = supportedAxis(market, currency);
    const assetType = normalizeText(row.assetType)?.toLowerCase() ?? null;
    const account = normalizeText(row.account)?.toLowerCase() ?? null;
    const source = normalizeText(row.source);
    const quantity = positiveNumber(row.quantity);
    const marketValueKrw = nonNegativeNumber(row.marketValueKrw);
    const label = normalizeText(row.assetName);

    if (identity.specialHoldingEvidence) {
      specialHoldingEvidence.push(identity.specialHoldingEvidence);
    }
    if (
      identity.specialHoldingEvidence?.historicalAuthorityOutcome ===
      "intentionally_excluded"
    ) {
      excludedPositionRows += 1;
      if (marketValueKrw === null) {
        blockers.add("invalid_anchor_position_evidence");
      }
      blockers.add("excluded_holding_scope_transform_required");
      continue;
    }
    const manualProductKey =
      identity.specialHoldingEvidence?.historicalAuthorityOutcome ===
        "manual_valuation_history_required" &&
      identity.specialHoldingEvidence.identityStatus === "resolved"
        ? identity.specialHoldingEvidence.resolvedProductKey
        : null;
    if (manualProductKey) {
      separateModelPositionRows += 1;
      if (
        !axis ||
        !account ||
        !selectedAccounts.includes(
          account as (typeof selectedAccounts)[number],
        ) ||
        !source ||
        !label ||
        quantity === null ||
        marketValueKrw === null
      ) {
        blockers.add("invalid_anchor_position_evidence");
        continue;
      }
      const key = manualInstrumentKey(manualProductKey);
      const existing = grouped.get(key) ?? {
        valuationModel: "stored_manual" as const,
        ticker: null,
        productKey: manualProductKey,
        market: axis.market,
        currency: axis.currency,
        labels: new Set<string>(),
        accounts: new Set<string>(),
        sourceRows: 0,
        storedMarketValueKrw: 0,
      };
      if (
        existing.valuationModel !== "stored_manual" ||
        existing.productKey !== manualProductKey
      ) {
        blockers.add("ambiguous_anchor_identity_metadata");
        continue;
      }
      if (existing.accounts.has(account)) {
        blockers.add("duplicate_anchor_identity");
      }
      existing.labels.add(label);
      existing.accounts.add(account);
      existing.sourceRows += 1;
      existing.storedMarketValueKrw += marketValueKrw;
      grouped.set(key, existing);
      recognizedPositionRows += 1;
      admittedSeparateModelPositionRows += 1;
      continue;
    }
    if (
      identity.specialHoldingEvidence?.historicalAuthorityOutcome ===
        "separate_valuation_model_required" &&
      identity.specialHoldingEvidence.identityStatus === "resolved"
    ) {
      separateModelPositionRows += 1;
    }
    if (!ticker && identity.specialHoldingEvidence?.identityStatus !== "resolved") {
      blockers.add("tickerless_anchor_holding");
    }
    if (!ticker && assetType === "commodity") {
      blockers.add("physical_anchor_holding");
    }
    if (!axis) {
      blockers.add("unsupported_anchor_holding_axis");
    }
    if (
      !account ||
      !selectedAccounts.includes(
        account as (typeof selectedAccounts)[number],
      ) ||
      !source ||
      !label ||
      quantity === null ||
      marketValueKrw === null
    ) {
      blockers.add("invalid_anchor_position_evidence");
    }
    if (
      !ticker ||
      !axis ||
      !account ||
      !source ||
      !label ||
      quantity === null ||
      marketValueKrw === null
    ) {
      continue;
    }

    const key = instrumentKey(axis.market, axis.currency, ticker);
    const existing = grouped.get(key) ?? {
      valuationModel: "listed_close" as const,
      ticker,
      productKey: null,
      market: axis.market,
      currency: axis.currency,
      labels: new Set<string>(),
      accounts: new Set<string>(),
      sourceRows: 0,
      storedMarketValueKrw: 0,
    };
    if (existing.accounts.has(account)) {
      blockers.add("duplicate_anchor_identity");
    }
    existing.labels.add(label);
    existing.accounts.add(account);
    existing.sourceRows += 1;
    existing.storedMarketValueKrw += marketValueKrw;
    grouped.set(key, existing);
    recognizedPositionRows += 1;
  }

  const instruments = [...grouped]
    .map(([key, row]) => {
      if (row.labels.size !== 1) {
        blockers.add("ambiguous_anchor_identity_metadata");
      }
      return Object.freeze({
        key,
        valuationModel: row.valuationModel,
        ticker: row.ticker,
        productKey: row.productKey,
        label: [...row.labels].sort()[0] ?? row.ticker,
        market: row.market,
        currency: row.currency,
        sourceRows: row.sourceRows,
        accountCount: row.accounts.size,
        storedMarketValueKrw: row.storedMarketValueKrw,
      });
    })
    .sort((left, right) => left.key.localeCompare(right.key));

  if (instruments.length > MAX_INSTRUMENTS) {
    blockers.add("instrument_limit_exceeded");
  }
  if (instruments.length === 0) {
    blockers.add("no_complete_anchor_evidence");
  }

  const unresolvedPositionRows =
    anchorRows.length -
    recognizedPositionRows -
    (separateModelPositionRows - admittedSeparateModelPositionRows) -
    excludedPositionRows;
  return Object.freeze({
    status: blockers.size === 0 ? "ready" : "unavailable",
    policy: INVESTMENT_LAB_ANCHOR_BASKET_POLICY,
    selectedAnchorDate,
    candidateAnchorDates: Object.freeze(candidateAnchorDates),
    instruments:
      blockers.size === 0 ? Object.freeze(instruments) : Object.freeze([]),
    coverage: Object.freeze({
      sourcePositionRows: anchorRows.length,
      recognizedPositionRows,
      separateModelPositionRows,
      excludedPositionRows,
      unresolvedPositionRows,
      economicInstrumentCount: instruments.length,
    }),
    specialHoldingEvidence: Object.freeze(
      specialHoldingEvidence.sort(compareSpecialHoldingEvidence),
    ),
    blockers: Object.freeze([...blockers].sort()),
  });
}

function compareSpecialHoldingEvidence(
  left: InvestmentLabAnchorSpecialHoldingEvidence,
  right: InvestmentLabAnchorSpecialHoldingEvidence,
) {
  return (
    left.account.localeCompare(right.account) ||
    left.name.localeCompare(right.name) ||
    (left.resolvedTicker ?? "").localeCompare(right.resolvedTicker ?? "")
  );
}

function portfolioSourceIndex(
  rows: readonly InvestmentLabSourceSnapshotRow[],
) {
  const index = new Map<string, Map<string, string | null>>();
  for (const row of rows) {
    const account = normalizeText(row.account)?.toLowerCase() ?? "";
    if (!isNamedPortfolioAccount(account)) {
      continue;
    }
    const byAccount = index.get(row.snapshotDate) ?? new Map();
    const source = normalizeText(row.source);
    if (byAccount.has(account)) byAccount.set(account, null);
    else byAccount.set(account, source);
    index.set(row.snapshotDate, byAccount);
  }
  return index;
}

function positionIndex(rows: readonly InvestmentLabAnchorPositionRow[]) {
  const index = new Map<string, InvestmentLabAnchorPositionRow[]>();
  for (const row of rows) {
    const account = normalizeText(row.account)?.toLowerCase() ?? "";
    const source = normalizeText(row.source) ?? "";
    const key = positionGroupKey(row.snapshotDate, account, source);
    const group = index.get(key) ?? [];
    group.push(row);
    index.set(key, group);
  }
  return index;
}

function positionGroupKey(date: string, account: string, source: string) {
  return `${date}\u0000${account}\u0000${source}`;
}

function instrumentKey(
  market: "korea" | "us",
  currency: "KRW" | "USD",
  ticker: string,
) {
  return `${market}:${currency}:${ticker}`;
}

function manualInstrumentKey(productKey: string) {
  return `manual:${productKey}`;
}

function supportedAxis(
  market: string | null,
  currency: string | null,
) {
  if (market === "korea" && currency === "KRW") {
    return { market, currency } as const;
  }
  if (market === "us" && currency === "USD") {
    return { market, currency } as const;
  }
  return null;
}

function isOrderedDateAxis(dates: readonly string[]) {
  return (
    dates.length >= 2 &&
    new Set(dates).size === dates.length &&
    dates.every(
      (date, index) =>
        isRiskDate(date) && (index === 0 || dates[index - 1] < date),
    )
  );
}

function normalizeText(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function positiveNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function unavailable(
  selectedAnchorDate: string | null,
  candidateAnchorDates: readonly string[],
  instruments: readonly InvestmentLabAnchorInstrument[],
  sourcePositionRows: number,
  recognizedPositionRows: number,
  blockers: Set<InvestmentLabAnchorBlocker>,
  specialHoldingEvidence: readonly InvestmentLabAnchorSpecialHoldingEvidence[] = [],
): InvestmentLabAnchorSelection {
  return Object.freeze({
    status: "unavailable",
    policy: INVESTMENT_LAB_ANCHOR_BASKET_POLICY,
    selectedAnchorDate,
    candidateAnchorDates: Object.freeze([...candidateAnchorDates]),
    instruments: Object.freeze([...instruments]),
    coverage: Object.freeze({
      sourcePositionRows,
      recognizedPositionRows,
      separateModelPositionRows: 0,
      excludedPositionRows: 0,
      unresolvedPositionRows: sourcePositionRows - recognizedPositionRows,
      economicInstrumentCount: instruments.length,
    }),
    specialHoldingEvidence: Object.freeze([...specialHoldingEvidence]),
    blockers: Object.freeze([...blockers].sort()),
  });
}
