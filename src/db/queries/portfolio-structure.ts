import "server-only";

import {
  and,
  desc,
  eq,
  getTableColumns,
  inArray,
  or,
  type SQL,
} from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db/client";
import { getPortfolioAnalysisScopeTargets } from "@/db/queries/portfolio-analysis-scope-targets";
import {
  loadActiveTenantLegacyAssetGroupBundle,
  type TenantLegacyAssetGroupMemberRow,
  type TenantLegacyAssetGroupRow,
} from "@/db/queries/tenant-group-reads";
import {
  loadLatestTenantPortfolioSettingsRows,
  type TenantPortfolioSettingsRow,
} from "@/db/queries/tenant-settings";
import {
  accounts,
  assets,
  fxRates,
  livePriceQuotes,
} from "@/db/schema";
import {
  buildPortfolioStructure,
  normalizeStructureAccount,
  type PortfolioStructureAccount,
  type PortfolioStructureIdentityScope,
  type PortfolioStructureResult,
} from "@/lib/portfolio-structure";
import { NAMED_PORTFOLIO_ACCOUNTS } from "@/lib/portfolio-account-scope";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { normalizeTicker, toNumber, uniqueStrings } from "@/lib/portfolio-math";
import type { TenantContext } from "@/lib/session-resolver-contract";

const INVESTMENT_ASSET_TYPES = new Set(["etf", "stock", "pension", "commodity"]);

export type ReadOnlyTenantPortfolioStructureOptions = {
  account?: string | string[] | null;
  tenantContext: TenantContext;
};

export async function getReadOnlyTenantPortfolioStructure({
  account,
  tenantContext,
}: ReadOnlyTenantPortfolioStructureOptions): Promise<PortfolioStructureResult> {
  const selectedAccount = normalizePortfolioStructureAccount(account);
  return loadReadOnlyTenantPortfolioStructure(
    tenantContext,
    selectedAccount,
  );
}

export async function getReadOnlyTenantPortfolioStructureForScope({
  scope,
  serviceDate,
  tenantContext,
}: {
  scope: PortfolioAnalysisScope;
  serviceDate: string;
  tenantContext: TenantContext;
}): Promise<PortfolioStructureResult> {
  const targets = await getPortfolioAnalysisScopeTargets({
    scope,
    serviceDate,
    tenantContext,
  });
  const assetScopePredicate = targets.includesAllOwnedAccounts
    ? undefined
    : combineScopePredicates([
        inArrayWhenPresent(accounts.id, targets.wholeAccountIds),
        inArrayWhenPresent(assets.id, targets.directAssetIds),
      ]);

  return loadTenantPortfolioStructureRows({
    assetScopePredicate,
    assetSelection: "preselected",
    identityScope:
      scope.kind === "account"
        ? "account_scoped"
        : "cross_account_exposure",
    namedAccountsOnly: false,
    selectedAccount: "all",
    tenantContext,
  });
}

const loadReadOnlyTenantPortfolioStructure = cache(
  loadTenantPortfolioStructure,
);

async function loadTenantPortfolioStructure(
  tenantContext: TenantContext,
  selectedAccount: PortfolioStructureAccount,
): Promise<PortfolioStructureResult> {
  return loadTenantPortfolioStructureRows({
    assetScopePredicate: undefined,
    assetSelection: "legacy_account_filter",
    identityScope:
      selectedAccount === "all"
        ? "cross_account_exposure"
        : "account_scoped",
    namedAccountsOnly: true,
    selectedAccount,
    tenantContext,
  });
}

async function loadTenantPortfolioStructureRows({
  assetScopePredicate,
  assetSelection,
  identityScope,
  namedAccountsOnly,
  selectedAccount,
  tenantContext,
}: {
  assetScopePredicate: SQL | null | undefined;
  assetSelection: "legacy_account_filter" | "preselected";
  identityScope: PortfolioStructureIdentityScope;
  namedAccountsOnly: boolean;
  selectedAccount: PortfolioStructureAccount;
  tenantContext: TenantContext;
}): Promise<PortfolioStructureResult> {
  const ownedAccountPredicates = activeOwnedAccountPredicates(
    tenantContext,
    namedAccountsOnly,
  );
  const [assetRows, legacyGroupRows, latestFxRows, settingsRows] =
    await Promise.all([
      assetScopePredicate === null
        ? Promise.resolve([])
        : db
            .select(getTableColumns(assets))
            .from(assets)
            .innerJoin(accounts, eq(assets.accountId, accounts.id))
            .where(
              and(
                ...ownedAccountPredicates,
                eq(assets.canonicalOwnerUserId, tenantContext.ownerUserId),
                eq(assets.account, accounts.code),
                assetScopePredicate,
              ),
            ),
      loadActiveTenantLegacyAssetGroupBundle(tenantContext),
      db.select().from(fxRates).orderBy(desc(fxRates.rateDate)).limit(1),
      loadLatestTenantPortfolioSettingsRows(tenantContext),
    ]);

  const selectedGroupIdByAssetId = new Map(
    assetRows.flatMap((asset) =>
      asset.groupId === null ? [] : [[asset.id, asset.groupId] as const],
    ),
  );
  const memberRows = legacyGroupRows.members.filter(
    (member) => selectedGroupIdByAssetId.get(member.assetId) === member.groupId,
  );

  return buildStructureFromRows({
    assetRows,
    groupRows: legacyGroupRows.groups,
    memberRows,
    latestFxRows,
    settingsRows,
    selectedAccount,
    assetSelection,
    identityScope,
  });
}

export function normalizePortfolioStructureAccount(
  account: string | string[] | null | undefined,
): PortfolioStructureAccount {
  const rawAccount = Array.isArray(account) ? account[0] : account;
  return normalizeStructureAccount(rawAccount);
}

async function buildStructureFromRows({
  assetRows,
  groupRows,
  memberRows,
  latestFxRows,
  settingsRows,
  selectedAccount,
  assetSelection = "legacy_account_filter",
  identityScope,
}: {
  assetRows: (typeof assets.$inferSelect)[];
  groupRows: readonly TenantLegacyAssetGroupRow[];
  memberRows: readonly TenantLegacyAssetGroupMemberRow[];
  latestFxRows: (typeof fxRates.$inferSelect)[];
  settingsRows: readonly TenantPortfolioSettingsRow[];
  selectedAccount: PortfolioStructureAccount;
  assetSelection?: "legacy_account_filter" | "preselected";
  identityScope?: PortfolioStructureIdentityScope;
}) {
  const structureAssetRows = assetRows.filter((asset) =>
    INVESTMENT_ASSET_TYPES.has(asset.assetType ?? "etf"),
  );
  const quoteRows = await loadLiveQuoteRows(structureAssetRows);
  const usdKrwRate =
    toNumber(latestFxRows[0]?.usdKrw) ??
    toNumber(settingsRows[0]?.usdKrwRate) ??
    null;

  return buildPortfolioStructure({
    assets: structureAssetRows,
    groups: [...groupRows],
    groupMembers: [...memberRows],
    liveQuotes: quoteRows,
    usdKrwRate,
    selectedAccount,
    assetSelection,
    identityScope,
  });
}

async function loadLiveQuoteRows(
  assetRows: (typeof assets.$inferSelect)[],
): Promise<(typeof livePriceQuotes.$inferSelect)[]> {
  const tickers = uniqueStrings(
    assetRows
      .map((asset) => normalizeTicker(asset.ticker))
      .filter((ticker): ticker is string => Boolean(ticker)),
  );

  if (tickers.length === 0) return [];

  return db
    .select()
    .from(livePriceQuotes)
    .where(inArray(livePriceQuotes.ticker, tickers))
    .orderBy(
      desc(livePriceQuotes.fetchedAt),
      desc(livePriceQuotes.priceAsOf),
      desc(livePriceQuotes.updatedAt),
    )
    .limit(Math.max(100, tickers.length * 4));
}

function activeOwnedAccountPredicates(
  tenantContext: TenantContext,
  namedAccountsOnly: boolean,
) {
  const predicates = [
    eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
    eq(accounts.isActive, true),
  ];
  if (namedAccountsOnly) {
    predicates.push(inArray(accounts.code, NAMED_PORTFOLIO_ACCOUNTS));
  }
  return predicates;
}

function inArrayWhenPresent(column: typeof accounts.id, values: readonly string[]): SQL | null;
function inArrayWhenPresent(column: typeof assets.id, values: readonly string[]): SQL | null;
function inArrayWhenPresent(
  column: typeof accounts.id | typeof assets.id,
  values: readonly string[],
) {
  return values.length > 0 ? inArray(column, values) : null;
}

function combineScopePredicates(predicates: readonly (SQL | null)[]) {
  const available = predicates.filter((predicate): predicate is SQL => predicate !== null);
  if (available.length === 0) return null;
  if (available.length === 1) return available[0];
  return or(...available) ?? null;
}
