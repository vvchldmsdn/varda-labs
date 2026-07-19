import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { getReadOnlyPortfolioRisk } from "@/db/queries/portfolio-risk";
import {
  assets,
  dailyPortfolioSnapshots,
  dailyPositionSnapshots,
} from "@/db/schema";
import { buildInvestmentLabDataAvailability } from "@/lib/investment-lab-data-availability";
import {
  DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS,
} from "@/lib/investment-lab-special-holding-authority";
import {
  accountsForPortfolioScope,
  type PortfolioAccountScope,
} from "@/lib/portfolio-account-scope";

// This remains a single-tenant read while Basic Auth is the only runtime gate.
// A future tenant repository must add the authenticated canonical owner filter.
export async function getReadOnlyInvestmentLabDataAvailability(
  account: PortfolioAccountScope,
) {
  const selectedAccounts = [...accountsForPortfolioScope(account)];
  const goldDecision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
  const [
    snapshotRows,
    manualValuationCurrentRows,
    manualValuationSnapshotRows,
    riskModel,
  ] = await Promise.all([
    db
      .select({
        snapshotDate: dailyPortfolioSnapshots.snapshotDate,
        account: sql<string>`lower(trim(${dailyPortfolioSnapshots.account}))`,
        source: dailyPortfolioSnapshots.source,
        ruleVersion: dailyPortfolioSnapshots.ruleVersion,
      })
      .from(dailyPortfolioSnapshots)
      .where(
        and(
          eq(dailyPortfolioSnapshots.isSample, false),
          inArray(
            sql<string>`lower(trim(${dailyPortfolioSnapshots.account}))`,
            selectedAccounts,
          ),
        ),
      )
      .orderBy(
        asc(dailyPortfolioSnapshots.snapshotDate),
        asc(dailyPortfolioSnapshots.account),
      ),
    db
      .select({
        assetId: assets.id,
        assetName: assets.name,
        account: assets.account,
        market: assets.market,
        currency: assets.currency,
        assetType: assets.assetType,
        currentPrice: assets.currentPrice,
        priceSource: assets.priceSource,
        priceAsOf: assets.priceAsOf,
        priceQuoteType: assets.priceQuoteType,
        priceStatus: assets.priceStatus,
      })
      .from(assets)
      .where(
        and(
          inArray(
            sql<string>`lower(trim(${assets.account}))`,
            selectedAccounts,
          ),
          eq(assets.name, goldDecision.assetName),
          eq(sql<string>`lower(trim(${assets.account}))`, goldDecision.account),
          eq(sql<string>`lower(trim(${assets.market}))`, goldDecision.market),
          eq(sql<string>`upper(trim(${assets.currency}))`, goldDecision.currency),
          eq(sql<string>`lower(trim(${assets.assetType}))`, goldDecision.assetType),
        ),
      )
      .orderBy(asc(assets.account), asc(assets.name)),
    db
      .select({
        snapshotDate: dailyPositionSnapshots.snapshotDate,
        assetId: dailyPositionSnapshots.assetId,
        legacyAssetId: dailyPositionSnapshots.legacyAssetId,
        assetName: dailyPositionSnapshots.assetName,
        account: dailyPositionSnapshots.account,
        market: dailyPositionSnapshots.market,
        currency: dailyPositionSnapshots.currency,
        assetType: dailyPositionSnapshots.assetType,
        source: dailyPositionSnapshots.source,
        priceSource: dailyPositionSnapshots.priceSource,
        priceBasis: dailyPositionSnapshots.priceBasis,
        currentPrice: dailyPositionSnapshots.currentPrice,
        priceDate: dailyPositionSnapshots.priceDate,
        referenceDate: dailyPositionSnapshots.referenceDate,
        capturedAt: dailyPositionSnapshots.capturedAt,
      })
      .from(dailyPositionSnapshots)
      .where(
        and(
          eq(dailyPositionSnapshots.isSample, false),
          inArray(
            sql<string>`lower(trim(${dailyPositionSnapshots.account}))`,
            selectedAccounts,
          ),
          eq(dailyPositionSnapshots.assetName, goldDecision.assetName),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.account}))`,
            goldDecision.account,
          ),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.market}))`,
            goldDecision.market,
          ),
          eq(
            sql<string>`upper(trim(${dailyPositionSnapshots.currency}))`,
            goldDecision.currency,
          ),
          eq(
            sql<string>`lower(trim(${dailyPositionSnapshots.assetType}))`,
            goldDecision.assetType,
          ),
        ),
      )
      .orderBy(
        asc(dailyPositionSnapshots.snapshotDate),
        asc(dailyPositionSnapshots.account),
        asc(dailyPositionSnapshots.assetName),
      ),
    getReadOnlyPortfolioRisk({ account, window: 90 }),
  ]);

  return buildInvestmentLabDataAvailability({
    account,
    snapshotRows,
    manualValuationCurrentRows,
    manualValuationSnapshotRows,
    marketHistory: {
      inputStatus: riskModel.inputHealth.status,
      requestedReturnObservations:
        riskModel.provenance.requestedReturnObservations,
      usableReturnObservations:
        riskModel.provenance.usableReturnObservations,
      returnCoveragePct: riskModel.provenance.returnCoveragePct,
      selectedHoldingCount: riskModel.provenance.selectedHoldingCount,
      eligibleHoldingCount: riskModel.provenance.eligibleHoldingCount,
      includedInstrumentCount: riskModel.provenance.includedInstrumentCount,
      excludedHoldings: riskModel.inputHealth.exclusions,
      blockerCount: riskModel.inputHealth.blockers.length,
      priceGapCount: riskModel.inputHealth.missingEvidence.priceGapCount,
      fxGapCount: riskModel.inputHealth.missingEvidence.fxGapCount,
    },
  });
}
