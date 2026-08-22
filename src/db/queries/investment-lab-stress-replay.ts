import "server-only";

import {
  loadPortfolioRiskFxRates,
  loadPortfolioRiskPriceCandidates,
} from "@/db/queries/portfolio-risk";
import { applyInvestmentLabCurrentHoldingScope } from "@/lib/investment-lab-current-holding-scope";
import {
  buildInvestmentLabStressReplay,
  INVESTMENT_LAB_STRESS_REPLAY_POLICY,
  INVESTMENT_LAB_STRESS_WINDOWS,
  type InvestmentLabStressPriceInput,
} from "@/lib/investment-lab-stress-replay";
import {
  admitAdjustedHistoricalPriceRows,
  admitSharedKisRawHistoricalPriceRows,
  selectPreferredPrivateHistoricalPriceRows,
} from "@/lib/market-data/asset-price-consumer-admission";
import { shiftRiskDate } from "@/lib/portfolio-risk-calendar";
import type { PortfolioStructureResult } from "@/lib/portfolio-structure";

const BENCHMARK_TICKERS = Object.freeze(["069500", "VOO"]);

export async function getReadOnlyTenantInvestmentLabStressReplay({
  account,
  portfolioStructurePromise,
}: {
  account: string;
  portfolioStructurePromise: Promise<PortfolioStructureResult>;
}) {
  const portfolioStructure = await portfolioStructurePromise;
  const scopedPortfolio = applyInvestmentLabCurrentHoldingScope(
    portfolioStructure,
  ).portfolio;
  const tickers = [
    ...new Set([
      ...scopedPortfolio.holdingRows
        .map((row) => row.ticker?.trim().toUpperCase())
        .filter((value): value is string => Boolean(value)),
      ...BENCHMARK_TICKERS,
    ]),
  ].sort();
  const sourceDateFrom = shiftRiskDate(
    INVESTMENT_LAB_STRESS_WINDOWS[0].startDate,
    -INVESTMENT_LAB_STRESS_REPLAY_POLICY.priceCarryCalendarDays,
  );
  const sourceDateTo = INVESTMENT_LAB_STRESS_WINDOWS.at(-1)!.endDate;
  const [candidateRows, fxRows] = await Promise.all([
    loadPortfolioRiskPriceCandidates({
      tickers,
      sourceDateFrom,
      sourceDateTo,
    }),
    loadPortfolioRiskFxRates({ sourceDateFrom, sourceDateTo }),
  ]);

  return buildInvestmentLabStressReplay({
    account,
    holdings: scopedPortfolio.holdingRows,
    priceRows: selectWindowPriceRows({
      candidateRows,
    }),
    fxRows,
  });
}

function selectWindowPriceRows({
  candidateRows,
}: {
  candidateRows: Awaited<ReturnType<typeof loadPortfolioRiskPriceCandidates>>;
}) {
  const selectedRows: InvestmentLabStressPriceInput[] = [];

  for (const window of INVESTMENT_LAB_STRESS_WINDOWS) {
    const scanStart = shiftRiskDate(
      window.startDate,
      -INVESTMENT_LAB_STRESS_REPLAY_POLICY.priceCarryCalendarDays,
    );
    const rows = candidateRows.filter(
      (row) => row.priceDate >= scanStart && row.priceDate <= window.endDate,
    );
    const adjustedRows = admitAdjustedHistoricalPriceRows(rows).rows;
    const privateRawRows = admitSharedKisRawHistoricalPriceRows(rows).rows;
    const preferred = selectPreferredPrivateHistoricalPriceRows({
      adjustedRows,
      privateRawRows,
    });

    selectedRows.push(
      ...preferred.rows.map(({ row, priceBasis }) => ({
        ticker: row.ticker,
        market: row.market,
        currency: row.currency,
        priceDate: row.priceDate,
        closePrice:
          priceBasis === "provider_adjusted_close"
            ? row.adjustedClosePrice
            : row.closePrice,
        priceBasis,
      })),
    );
  }

  return selectedRows;
}
