import { Decimal } from "../money.ts";
import type { DashboardData } from "../portfolio-dashboard";
import type { PortfolioStructureResult } from "../portfolio-structure";

export type InvestmentCostRow = {
  key: string; name: string; ticker: string | null; account: string;
  costKrw: number | null; valueKrw: number; pnlKrw: number | null; returnPct: number | null;
  reason: string | null;
};
export type InvestmentReturn = {
  basis: "investment_assets_excluding_cash"; currency: "KRW";
  costKrw: number | null; pnlKrw: number | null; returnPct: number | null; reason: string | null;
  coverage?: { confirmed: number; total: number; knownCostKrw: number; knownPnlKrw: number; knownReturnPct: number | null };
  rows?: InvestmentCostRow[];
};

/** The value hero and cost read must describe the same holdings and prices. */
export function alignedInvestmentReturn(dashboard: DashboardData, structure: PortfolioStructureResult) {
  const result = dashboard.investmentReturn;
  if (!result) return undefined;
  const keys = (rows: (readonly unknown[])[]) => rows.map(row => JSON.stringify(row)).sort();
  const a = keys(dashboard.holdings.map(r => [r.account, r.market, r.currency, r.ticker, r.name, r.quantity, r.valueKrw]));
  const b = keys(structure.holdingRows.map(r => [r.account, r.market, r.currency, r.ticker, r.name, r.quantity, r.currentValueKrw]));
  return !structure.exclusions.length && JSON.stringify(a) === JSON.stringify(b) ? result
    : { ...result, costKrw: null, pnlKrw: null, returnPct: null, coverage: undefined, rows: undefined, reason: "valuation_basis_changed" };
}
type BasisPosition = { assetId: string; currency: string; quantity: string; costKrw: string | null };

/** Compare the current holdings with their remaining purchase cost after disposals. */
export function investmentHoldingReturn(holdings: DashboardData["holdings"], basis: { positions: BasisPosition[] } | null): InvestmentReturn {
  const result: InvestmentReturn = { basis: "investment_assets_excluding_cash", currency: "KRW", costKrw: null, pnlKrw: null, returnPct: null, reason: null };
  if (basis) {
    try {
      return calculateHoldingReturn(holdings, basis.positions, result);
    } catch {
      // Malformed cost evidence must not prevent the rest of the dashboard from loading.
    }
  }
  return { ...result, reason: "investment_read_unavailable" };
}

function calculateHoldingReturn(holdings: DashboardData["holdings"], basis: BasisPosition[], result: InvestmentReturn): InvestmentReturn {
  if (!holdings.length) return { ...result, reason: "empty" };
  let cost = Decimal.from(0), value = Decimal.from(0);
  const rows: InvestmentCostRow[] = [];
  const positions = new Map(basis.map(p => [p.assetId, p]));
  for (const row of holdings) {
    const p = positions.get(row.id);
    const aligned = !p || (p.currency === row.currency && Decimal.from(p.quantity).compare(row.quantity) === 0);
    const c = p ? aligned ? p.costKrw : null : row.costBasisKrw;
    const known = c !== null && Number.isFinite(row.valueKrw) && row.valueKrw >= 0 && Number.isFinite(Number(c)) && Number(c) >= 0;
    const pnl = known ? Decimal.from(row.valueKrw).sub(c) : null;
    rows.push({ key: JSON.stringify([row.account, row.market, row.currency, row.ticker, row.name]), name: row.name, ticker: row.ticker, account: row.account,
      costKrw: known ? Number(c) : null, valueKrw: row.valueKrw, pnlKrw: pnl?.toNumber() ?? null,
      returnPct: known && Number(c) > 0 ? pnl!.div(c).mul(100).toNumber() : null,
      reason: known ? null : !aligned ? 'quantity_basis_changed' : 'cost_or_valuation_missing' });
    if (known) { cost = cost.add(c); value = value.add(row.valueKrw); }
  }
  const coverage = { confirmed: rows.filter(r => r.costKrw !== null).length, total: rows.length, knownCostKrw: cost.toNumber(), knownPnlKrw: value.sub(cost).toNumber(), knownReturnPct: cost.compare(0) > 0 ? value.sub(cost).div(cost).mul(100).toNumber() : null };
  if (coverage.confirmed !== coverage.total) return { ...result, rows, coverage, reason: 'cost_coverage_incomplete' };
  return { ...result, rows, coverage, costKrw: cost.toNumber(), pnlKrw: value.sub(cost).toNumber(), returnPct: coverage.knownReturnPct, reason: cost.compare(0) === 0 ? "zero_cost" : null };
}
