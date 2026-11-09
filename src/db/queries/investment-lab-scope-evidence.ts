import "server-only";
import { brokerRecoverySnapshotPredicate } from "@/db/queries/broker-recovery-snapshot-scope";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { loadLabNativeEvents } from "./investment-lab-native-events";

import { db } from "@/db/client";
import { loadTenantPortfolioGroupMemberships } from "@/db/queries/tenant-group-reads";
import {
  accounts,
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
  eventLedgerEntries,
} from "@/db/schema";
import {
  buildInvestmentLabAnalysisScopeEvidence,
  type InvestmentLabAnalysisScopeEvidence,
} from "@/lib/investment-lab-analysis-scope";
import {
  buildInvestmentLabHistoricalAccountConsensus,
  resolveInvestmentLabEventAccount,
} from "@/lib/investment-lab-event-account";
import { attachBase44ImportedTickerEvidence } from "@/lib/investment-lab-special-holding-authority";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";

export async function getReadOnlyTenantInvestmentLabAnalysisScopeEvidence({
  scope,
  tenantContext,
  includeEffectiveNativeTrades = false,
}: {
  scope: PortfolioAnalysisScope;
  tenantContext: TenantContext;
  includeEffectiveNativeTrades?: boolean;
}): Promise<InvestmentLabAnalysisScopeEvidence> {
  // A group can contain assets or formerly active accounts at different
  // dates. The native adapter is admitted for a single resolved account only.
  const readNative = includeEffectiveNativeTrades && scope.kind === "account";
  const [
    ownedAccounts,
    memberships,
    positionRows,
    eventRows,
    provenanceRows,
  ] = await Promise.all([
    db
      .select({
        id: accounts.id,
        code: accounts.code,
        isActive: accounts.isActive,
        ...(readNative ? {hasNative: sql<boolean>`${accounts.nativeState} is not null`} : {}),
      })
      .from(accounts)
      .where(eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId)),
    scope.kind === "portfolio_group"
      ? loadTenantPortfolioGroupMemberships({
          mode: "all",
          portfolioGroupId: scope.portfolioGroupId,
          tenantContext,
        })
      : Promise.resolve(
          Object.freeze({
            accountMemberships: Object.freeze([]),
            assetMemberships: Object.freeze([]),
          }),
        ),
    db
      .select({
        snapshotDate: dailyPositionSnapshots.snapshotDate,
        assetId: dailyPositionSnapshots.assetId,
        legacyAssetId: dailyPositionSnapshots.legacyAssetId,
        accountId: dailyPositionSnapshots.accountId,
        account: dailyPositionSnapshots.account,
        source: dailyPositionSnapshots.source,
        ticker: dailyPositionSnapshots.ticker,
        assetName: dailyPositionSnapshots.assetName,
        market: dailyPositionSnapshots.market,
        currency: dailyPositionSnapshots.currency,
        assetType: dailyPositionSnapshots.assetType,
        quantity: dailyPositionSnapshots.quantity,
        marketValueKrw: dailyPositionSnapshots.marketValueKrw,
        priceSource: dailyPositionSnapshots.priceSource,
        priceBasis: dailyPositionSnapshots.priceBasis,
        currentPrice: dailyPositionSnapshots.currentPrice,
        priceDate: dailyPositionSnapshots.priceDate,
        referenceDate: dailyPositionSnapshots.referenceDate,
        capturedAt: dailyPositionSnapshots.capturedAt,
        identityKey: dailyPositionSnapshots.legacyAssetId,
      })
      .from(dailyPositionSnapshots)
      .where(
        and(
          eq(
            dailyPositionSnapshots.canonicalOwnerUserId,
            tenantContext.ownerUserId,
          ),
          eq(dailyPositionSnapshots.isSample, false),
          brokerRecoverySnapshotPredicate("daily_position_snapshots"),
        ),
      )
      .orderBy(
        asc(dailyPositionSnapshots.snapshotDate),
        asc(dailyPositionSnapshots.account),
        asc(dailyPositionSnapshots.source),
        sql`${dailyPositionSnapshots.ticker} asc nulls last`,
        asc(dailyPositionSnapshots.assetName),
      ),
    db
      .select({
        accountId: eventLedgerEntries.accountId,
        assetId: eventLedgerEntries.assetId,
        account: eventLedgerEntries.account,
        beforeValue: eventLedgerEntries.beforeValue,
        afterValue: eventLedgerEntries.afterValue,
        legacyAssetId: eventLedgerEntries.legacyAssetId,
        assetName: eventLedgerEntries.assetName,
        assetAccount: assets.account,
        eventDate: eventLedgerEntries.eventDate,
        eventType: eventLedgerEntries.eventType,
        amountKrw: eventLedgerEntries.amountKrw,
        quantityDelta: eventLedgerEntries.quantityDelta,
        price: eventLedgerEntries.price,
        fxRate: eventLedgerEntries.fxRate,
        assetCurrency: assets.currency,
        market: assets.market,
        currency: assets.currency,
        assetType: assets.assetType,
        correctsEventId: eventLedgerEntries.correctsEventId,
        legacyCorrectsEventId: eventLedgerEntries.legacyCorrectsEventId,
      })
      .from(eventLedgerEntries)
      .innerJoin(accounts, eq(eventLedgerEntries.accountId, accounts.id))
      .leftJoin(
        assets,
        and(
          eq(eventLedgerEntries.assetId, assets.id),
          eq(assets.canonicalOwnerUserId, tenantContext.ownerUserId),
        ),
      )
      .where(
        and(
          eq(accounts.canonicalOwnerUserId, tenantContext.ownerUserId),
          eq(eventLedgerEntries.isSample, false),
          readNative ? isNull(eventLedgerEntries.nativeData) : undefined,
        ),
      )
      .orderBy(
        asc(eventLedgerEntries.eventDate),
        sql`${eventLedgerEntries.recordedAt} asc nulls last`,
        asc(eventLedgerEntries.createdAt),
        sql`${eventLedgerEntries.legacyBase44Id} asc nulls last`,
        asc(eventLedgerEntries.id),
      ),
    db
      .select({
        snapshotDate: dailyPortfolioSnapshots.snapshotDate,
        accountId: dailyPortfolioSnapshots.accountId,
        account: dailyPortfolioSnapshots.account,
        cashValue: dailyPortfolioSnapshots.cashValue,
        fxRate: dailyPortfolioSnapshots.fxRate,
        usdKrw: dailyPortfolioSnapshots.usdKrw,
        source: dailyPortfolioSnapshots.source,
        ruleVersion: dailyPortfolioSnapshots.ruleVersion,
      })
      .from(dailyPortfolioSnapshots)
      .where(
        and(
          eq(
            dailyPortfolioSnapshots.canonicalOwnerUserId,
            tenantContext.ownerUserId,
          ),
          eq(dailyPortfolioSnapshots.isSample, false),
          brokerRecoverySnapshotPredicate("daily_portfolio_snapshots"),
          isNotNull(dailyPortfolioSnapshots.accountId),
        ),
      ),
  ]);

  const importedPositionRows = attachBase44ImportedTickerEvidence(
    positionRows,
  );
  const historicalConsensus = buildInvestmentLabHistoricalAccountConsensus(
    importedPositionRows.flatMap((row) =>
      row.legacyAssetId
        ? [{ legacyAssetId: row.legacyAssetId, account: row.account }]
        : [],
    ),
  );
  const nativeAccount = readNative && ownedAccounts.find(account =>
    account.isActive && account.hasNative && scope.accountId === account.id,
  );
  const nativeEvents = nativeAccount ? await loadLabNativeEvents(tenantContext, nativeAccount.id) : [];

  return buildInvestmentLabAnalysisScopeEvidence({
    scope,
    accounts: ownedAccounts,
    accountMemberships: memberships.accountMemberships,
    assetMemberships: memberships.assetMemberships,
    positions: importedPositionRows.map((row) => {
      const { identityKey, ...position } = row;
      void identityKey;
      return position;
    }),
    provenanceRows: provenanceRows.flatMap((row) =>
      row.accountId
        ? [
            {
              snapshotDate: row.snapshotDate,
              accountId: row.accountId,
              account: row.account,
              cashValue: row.cashValue,
              usdKrw: row.usdKrw ?? row.fxRate,
              source: row.source,
              ruleVersion: row.ruleVersion,
            },
          ]
        : [],
    ),
    events: [...eventRows.map((row, index) => ({
      accountId: row.accountId,
      assetId: row.assetId,
      legacyAssetId: row.legacyAssetId,
      account: resolveInvestmentLabEventAccount(
        row,
        historicalConsensus,
      ).account,
      eventDate: row.eventDate,
      eventType: row.eventType,
      sequence: index + 1,
      amountKrw: row.amountKrw,
      quantityDelta: row.quantityDelta,
      price: row.price,
      fxRate: row.fxRate,
      assetCurrency: row.assetCurrency,
      isCorrection:
        row.correctsEventId !== null || row.legacyCorrectsEventId !== null,
      assetName: row.assetName,
      market: row.market,
      currency: row.currency,
      assetType: row.assetType,
    })), ...nativeEvents],
  });
}
