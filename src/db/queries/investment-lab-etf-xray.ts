import "server-only";

import { and, asc, eq, inArray, max, or } from "drizzle-orm";

import { db } from "@/db/client";
import { etfHoldings, etfMasters } from "@/db/schema";
import { getReadOnlyPortfolioStructure } from "@/db/queries/portfolio-structure";
import {
  buildInvestmentLabEtfXray,
  selectInvestmentLabEtfXrayMasterIds,
  type InvestmentLabEtfXrayMasterInput,
  type InvestmentLabEtfXrayModel,
} from "@/lib/investment-lab-etf-xray";
import type { EtfHoldingRawRow } from "@/lib/etf-holdings";

export async function getReadOnlyInvestmentLabEtfXray(): Promise<InvestmentLabEtfXrayModel> {
  const [portfolio, masters] = await Promise.all([
    getReadOnlyPortfolioStructure({ account: "all" }),
    loadEtfMasters(),
  ]);
  const masterIds = selectInvestmentLabEtfXrayMasterIds({
    portfolioHoldings: portfolio.holdingRows,
    masters,
  });
  const holdingEvidence = await loadLatestHoldingEvidence(masterIds);

  return buildInvestmentLabEtfXray({
    portfolioHoldings: portfolio.holdingRows,
    portfolioExclusions: portfolio.exclusions,
    masters,
    holdingEvidence,
  });
}

function loadEtfMasters(): Promise<InvestmentLabEtfXrayMasterInput[]> {
  return db
    .select({
      referenceId: etfMasters.id,
      ticker: etfMasters.ticker,
      name: etfMasters.name,
      market: etfMasters.market,
      currency: etfMasters.currency,
    })
    .from(etfMasters);
}

async function loadLatestHoldingEvidence(
  masterIds: readonly string[],
): Promise<EtfHoldingRawRow[]> {
  if (masterIds.length === 0) return [];

  const latestDates = await db
    .select({
      etfMasterId: etfHoldings.etfMasterId,
      asOfDate: max(etfHoldings.asOfDate),
    })
    .from(etfHoldings)
    .where(inArray(etfHoldings.etfMasterId, [...masterIds]))
    .groupBy(etfHoldings.etfMasterId);
  const selectors = latestDates.flatMap((row) =>
    row.etfMasterId && row.asOfDate
      ? [
          and(
            eq(etfHoldings.etfMasterId, row.etfMasterId),
            eq(etfHoldings.asOfDate, row.asOfDate),
          ),
        ]
      : [],
  );
  const selector = or(...selectors);
  if (!selector) return [];

  return db
    .select({
      id: etfHoldings.id,
      legacyBase44Id: etfHoldings.legacyBase44Id,
      etfMasterId: etfHoldings.etfMasterId,
      legacyEtfId: etfHoldings.legacyEtfId,
      etfTicker: etfHoldings.etfTicker,
      etfName: etfHoldings.etfName,
      asOfDate: etfHoldings.asOfDate,
      holdingSymbol: etfHoldings.holdingSymbol,
      holdingName: etfHoldings.holdingName,
      holdingMarket: etfHoldings.holdingMarket,
      holdingCountry: etfHoldings.holdingCountry,
      currency: etfHoldings.currency,
      sector: etfHoldings.sector,
      industry: etfHoldings.industry,
      securityType: etfHoldings.securityType,
      source: etfHoldings.source,
      rank: etfHoldings.rank,
      weightPct: etfHoldings.weightPct,
      shares: etfHoldings.shares,
      marketValue: etfHoldings.marketValue,
    })
    .from(etfHoldings)
    .where(selector)
    .orderBy(
      asc(etfHoldings.etfTicker),
      asc(etfHoldings.rank),
      asc(etfHoldings.holdingName),
    );
}
