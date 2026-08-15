import type {
  InvestmentLabSourceEventRow,
  InvestmentLabSourceSnapshotRow,
} from "./investment-lab-counterfactual-read-model.ts";
import type { InvestmentLabAnchorPositionRow } from "./investment-lab-anchor-basket-anchor.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "./investment-lab-special-holding-authority.ts";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  isNamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";
import type { PortfolioAnalysisScope } from "./portfolio-analysis-scope.ts";

export const INVESTMENT_LAB_ANALYSIS_SCOPE_POLICY = Object.freeze({
  version: "effective_dated_investment_lab_scope_v1",
  membershipWindow: "valid_from_inclusive_valid_to_exclusive",
  membershipUnion: "whole_account_or_direct_asset",
  overlapBehavior: "single_source_row_counted_once",
  historicalValuationBasis: "stored_position_snapshot_market_value_krw",
  missingValuationBehavior: "retain_date_as_incomplete_without_imputation",
  excludedHolding: "fount",
  legacyEngineAdapterAccount: "brokerage",
} as const);

export type InvestmentLabScopeAccount = Readonly<{
  id: string;
  code: string;
  isActive: boolean;
}>;

export type InvestmentLabScopeMembership = Readonly<{
  targetId: string;
  validFrom: string;
  validTo: string | null;
}>;

export type InvestmentLabScopePositionCandidate =
  InvestmentLabAnchorPositionRow &
    Readonly<{
      accountId: string | null;
      assetId: string | null;
    }>;

export type InvestmentLabScopeEventCandidate = InvestmentLabSourceEventRow &
  Readonly<{
    accountId: string | null;
    assetId: string | null;
    assetName: string | null;
    market: string | null;
    currency: string | null;
    assetType: string | null;
  }>;

export type InvestmentLabScopeSnapshotProvenance = Readonly<{
  snapshotDate: string;
  accountId: string;
  account: string;
  source: string;
  ruleVersion: string | null;
}>;

export type InvestmentLabAnalysisScopeEvidence = Readonly<{
  policy: typeof INVESTMENT_LAB_ANALYSIS_SCOPE_POLICY;
  engineAccount: PortfolioAccountScope;
  supportsLegacyTargetPolicy: boolean;
  includedAccountCodes: readonly string[];
  snapshotRows: readonly InvestmentLabSourceSnapshotRow[];
  eventRows: readonly InvestmentLabSourceEventRow[];
  anchorPositionRows: readonly InvestmentLabAnchorPositionRow[];
  fountAdjustment: Readonly<{
    status: "not_applicable" | "applied";
    excludedPositionRowCount: number;
    excludedEventRowCount: number;
    adjustedDateCount: number;
  }>;
}>;

export function buildInvestmentLabAnalysisScopeEvidence({
  accountMemberships = [],
  accounts,
  assetMemberships = [],
  events,
  positions,
  provenanceRows,
  scope,
}: {
  accountMemberships?: readonly InvestmentLabScopeMembership[];
  accounts: readonly InvestmentLabScopeAccount[];
  assetMemberships?: readonly InvestmentLabScopeMembership[];
  events: readonly InvestmentLabScopeEventCandidate[];
  positions: readonly InvestmentLabScopePositionCandidate[];
  provenanceRows: readonly InvestmentLabScopeSnapshotProvenance[];
  scope: PortfolioAnalysisScope;
}): InvestmentLabAnalysisScopeEvidence {
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const activeAccountIds = new Set(
    accounts.filter((account) => account.isActive).map((account) => account.id),
  );
  const selectedPositions = positions.filter((row) =>
    isIncludedAtDate({
      accountMemberships,
      assetMemberships,
      activeAccountIds,
      date: row.snapshotDate,
      row,
      scope,
    }),
  );
  const selectedEvents = events.filter((row) =>
    isIncludedAtDate({
      accountMemberships,
      assetMemberships,
      activeAccountIds,
      date: row.eventDate,
      row,
      scope,
    }),
  );
  const fountIdentity = collectFountIdentity(selectedPositions);
  const scopedPositions = selectedPositions.filter(
    (row) => !matchesFountPosition(row),
  );
  const scopedEvents = selectedEvents.filter(
    (row) => !matchesFountEvent(row, fountIdentity),
  );
  const includedAccountCodes = Object.freeze(
    [
      ...new Set(
        [...selectedPositions, ...selectedEvents].flatMap((row) => {
          if (!row.accountId) return [];
          const account = accountById.get(row.accountId);
          return account ? [account.code] : [];
        }),
      ),
    ].sort(),
  );
  const engine = resolveEngineAccount(scope, includedAccountCodes);
  const snapshotRows = buildSnapshotRows({
    engineAccount: engine.account,
    positions: scopedPositions,
    provenanceRows,
  });
  const remapAccount = engine.account !== "all" && engine.rewritesAccounts;
  const anchorPositionRows = Object.freeze(
    scopedPositions.map((row) => {
      const { accountId, ...position } = row;
      void accountId;
      return Object.freeze({
        ...position,
        account: remapAccount ? engine.account : position.account,
        identityAccount: position.account,
      });
    }),
  );
  const eventRows = Object.freeze(
    scopedEvents.map((row, index) =>
      Object.freeze({
        legacyAssetId: row.legacyAssetId,
        account: remapAccount ? engine.account : row.account,
        eventDate: row.eventDate,
        eventType: row.eventType,
        sequence: index + 1,
        amountKrw: row.amountKrw,
        quantityDelta: row.quantityDelta,
        price: row.price,
        fxRate: row.fxRate,
        assetCurrency: row.assetCurrency,
        isCorrection: row.isCorrection,
      }),
    ),
  );
  const excludedPositions = selectedPositions.filter(matchesFountPosition);
  const excludedEvents = selectedEvents.filter((row) =>
    matchesFountEvent(row, fountIdentity),
  );

  return Object.freeze({
    policy: INVESTMENT_LAB_ANALYSIS_SCOPE_POLICY,
    engineAccount: engine.account,
    supportsLegacyTargetPolicy: engine.supportsLegacyTargetPolicy,
    includedAccountCodes,
    snapshotRows,
    eventRows,
    anchorPositionRows,
    fountAdjustment: Object.freeze({
      status:
        excludedPositions.length + excludedEvents.length > 0
          ? "applied"
          : "not_applicable",
      excludedPositionRowCount: excludedPositions.length,
      excludedEventRowCount: excludedEvents.length,
      adjustedDateCount: new Set(
        excludedPositions.map((row) => row.snapshotDate),
      ).size,
    }),
  });
}

function resolveEngineAccount(
  scope: PortfolioAnalysisScope,
  accountCodes: readonly string[],
) {
  if (
    scope.kind === "account" &&
    isNamedPortfolioAccount(scope.accountCode)
  ) {
    return Object.freeze({
      account: scope.accountCode,
      rewritesAccounts: false,
      supportsLegacyTargetPolicy: true,
    });
  }

  const sortedNamedAccounts = [...NAMED_PORTFOLIO_ACCOUNTS].sort();
  if (
    scope.kind === "all" &&
    accountCodes.length === sortedNamedAccounts.length &&
    accountCodes.every((account, index) => account === sortedNamedAccounts[index])
  ) {
    return Object.freeze({
      account: "all" as const,
      rewritesAccounts: false,
      supportsLegacyTargetPolicy: true,
    });
  }

  return Object.freeze({
    account: INVESTMENT_LAB_ANALYSIS_SCOPE_POLICY.legacyEngineAdapterAccount,
    rewritesAccounts: true,
    supportsLegacyTargetPolicy: false,
  });
}

function buildSnapshotRows({
  engineAccount,
  positions,
  provenanceRows,
}: {
  engineAccount: PortfolioAccountScope;
  positions: readonly InvestmentLabScopePositionCandidate[];
  provenanceRows: readonly InvestmentLabScopeSnapshotProvenance[];
}) {
  const provenance = new Map(
    provenanceRows.map((row) => [
      provenanceKey(row.snapshotDate, row.accountId, row.source),
      row,
    ]),
  );
  const groups = new Map<string, InvestmentLabScopePositionCandidate[]>();

  for (const row of positions) {
    const account = engineAccount === "all" ? row.account : engineAccount;
    const key = `${row.snapshotDate}\u0000${account}\u0000${row.source ?? ""}`;
    const current = groups.get(key);
    if (current) current.push(row);
    else groups.set(key, [row]);
  }

  return Object.freeze(
    [...groups.entries()]
      .map(([key, rows]) => {
        const [snapshotDate, account, source] = key.split("\u0000");
        const values = rows.map((row) => finiteNonNegative(row.marketValueKrw));
        const totalMarketValue = values.every(
          (value): value is number => value !== null,
        )
          ? values.reduce((sum, value) => sum + value, 0)
          : null;
        const ruleVersions = new Set(
          rows.flatMap((row) => {
            if (!row.accountId || !row.source) return [null];
            return [
              provenance.get(
                provenanceKey(row.snapshotDate, row.accountId, row.source),
              )?.ruleVersion ?? null,
            ];
          }),
        );
        const ruleVersion =
          ruleVersions.size === 1 ? [...ruleVersions][0] : null;

        return Object.freeze({
          snapshotDate,
          account,
          cashValue: null,
          totalMarketValue,
          usdKrw: null,
          source: source || null,
          ruleVersion,
        });
      })
      .sort(
        (left, right) =>
          left.snapshotDate.localeCompare(right.snapshotDate) ||
          left.account.localeCompare(right.account) ||
          String(left.source).localeCompare(String(right.source)),
      ),
  );
}

function isIncludedAtDate({
  accountMemberships,
  activeAccountIds,
  assetMemberships,
  date,
  row,
  scope,
}: {
  accountMemberships: readonly InvestmentLabScopeMembership[];
  activeAccountIds: ReadonlySet<string>;
  assetMemberships: readonly InvestmentLabScopeMembership[];
  date: string;
  row: Readonly<{ accountId: string | null; assetId: string | null }>;
  scope: PortfolioAnalysisScope;
}) {
  if (scope.kind === "all") {
    return row.accountId !== null && activeAccountIds.has(row.accountId);
  }
  if (scope.kind === "account") return row.accountId === scope.accountId;

  return (
    (row.accountId !== null &&
      accountMemberships.some(
        (membership) =>
          membership.targetId === row.accountId &&
          isActiveOn(membership, date),
      )) ||
    (row.assetId !== null &&
      assetMemberships.some(
        (membership) =>
          membership.targetId === row.assetId && isActiveOn(membership, date),
      ))
  );
}

function isActiveOn(membership: InvestmentLabScopeMembership, date: string) {
  return (
    membership.validFrom <= date &&
    (membership.validTo === null || date < membership.validTo)
  );
}

function collectFountIdentity(
  rows: readonly InvestmentLabScopePositionCandidate[],
) {
  const assetIds = new Set<string>();
  const legacyAssetIds = new Set<string>();
  for (const row of rows) {
    if (!matchesFountPosition(row)) continue;
    if (row.assetId) assetIds.add(row.assetId);
    if (row.legacyAssetId) legacyAssetIds.add(row.legacyAssetId);
  }
  return Object.freeze({ assetIds, legacyAssetIds });
}

function matchesFountPosition(row: InvestmentLabScopePositionCandidate) {
  return matchesFountMetadata(row);
}

function matchesFountEvent(
  row: InvestmentLabScopeEventCandidate,
  identity: Readonly<{
    assetIds: ReadonlySet<string>;
    legacyAssetIds: ReadonlySet<string>;
  }>,
) {
  return (
    matchesFountMetadata(row) ||
    (row.assetId != null && identity.assetIds.has(row.assetId)) ||
    (row.legacyAssetId != null &&
      identity.legacyAssetIds.has(row.legacyAssetId))
  );
}

function matchesFountMetadata(row: Readonly<{
  account?: string | null;
  assetName?: string | null;
  market?: string | null;
  currency?: string | null;
  assetType?: string | null;
}>) {
  const decision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
  return (
    normalize(row.assetName) === normalize(decision.assetName) &&
    normalize(row.account) === decision.account &&
    normalize(row.market) === decision.market &&
    normalizeUpper(row.currency) === decision.currency &&
    normalize(row.assetType) === decision.assetType
  );
}

function provenanceKey(date: string, accountId: string, source: string) {
  return `${date}\u0000${accountId}\u0000${source}`;
}

function finiteNonNegative(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalize(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeUpper(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
