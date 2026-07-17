import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { dailyPortfolioSnapshots } from "@/db/schema";
import { getReadOnlyPortfolioRisk } from "@/db/queries/portfolio-risk";
import { buildInvestmentLabDataAvailability } from "@/lib/investment-lab-data-availability";
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
  const [snapshotRows, riskModel] = await Promise.all([
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
    getReadOnlyPortfolioRisk({ account, window: 90 }),
  ]);

  return buildInvestmentLabDataAvailability({
    account,
    snapshotRows,
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
