import type { PortfolioStructureResult } from "./portfolio-structure.ts";

/** A current composition only: no acquisition cost, personal returns or invented past holdings. */
export function buildFirstPortfolioAnalysis(portfolio: PortfolioStructureResult) {
  const holdings = portfolio.holdingRows.filter((holding) => holding.currentValueKrw > 0);
  const valuationComplete = portfolio.exclusions.length === 0 && holdings.length > 0;
  const totalValueKrw = holdings.reduce((sum, holding) => sum + holding.currentValueKrw, 0);
  const valuesValid = Number.isFinite(totalValueKrw) && totalValueKrw > 0;
  const complete = valuationComplete && valuesValid;
  const exposures = new Map<string, { name: string; ticker: string | null; valueKrw: number }>();
  for (const holding of holdings) {
    const key = [holding.market, holding.currency, holding.ticker ?? `${holding.account}|${holding.name}`].join("|");
    const current = exposures.get(key);
    exposures.set(key, { name: current?.name ?? holding.name, ticker: holding.ticker, valueKrw: (current?.valueKrw ?? 0) + holding.currentValueKrw });
  }
  const rows = [...exposures.entries()]
    .map(([key, row]) => ({ ...row, key, weightPct: complete ? row.valueKrw / totalValueKrw * 100 : null }))
    .sort((a, b) => b.valueKrw - a.valueKrw || a.key.localeCompare(b.key));
  return Object.freeze({
    state: holdings.length === 0 && portfolio.exclusions.length === 0 ? "empty" as const : complete ? "complete" as const : "partial" as const,
    totalValueKrw: complete ? totalValueKrw : null,
    knownValueKrw: Number.isFinite(totalValueKrw) ? totalValueKrw : null,
    holdingCount: portfolio.holdingRows.length + portfolio.exclusions.length,
    unvaluedHoldingCount: portfolio.exclusions.length,
    largestHolding: complete ? rows[0] ?? null : null,
    usdWeightPct: complete ? holdings.filter((row) => row.currency === "USD").reduce((sum, row) => sum + row.currentValueKrw, 0) / totalValueKrw * 100 : null,
    rows: Object.freeze(rows),
  });
}

export type FirstPortfolioAnalysis = ReturnType<typeof buildFirstPortfolioAnalysis>;
