import type { BrokerRealizedStatement } from "../broker-realized-statement";
import type { Currency } from "../money";
import type { valueRecordedSales } from "../currency-tracked-portfolio";

export type RealizedLedgerSummary = {
  total:string|null; verifiedSubtotal:string|null; through:string;
  sales:number; valued:number; missingCostSales:number; scopeComplete:boolean; fees:"separate";
};
export type BetaRealizedProfit = {
  scope:string; ledger:Record<Currency,RealizedLedgerSummary>|null; broker:BrokerRealizedStatement[]|null;
};

export function summarizeRecordedSales(report:ReturnType<typeof valueRecordedSales>):RealizedLedgerSummary {
  return {total:report.total,verifiedSubtotal:report.coverage.valued ? report.verifiedSubtotal : null,
    through:report.through,sales:report.coverage.sales,valued:report.coverage.valued,scopeComplete:report.coverage.scopeComplete,
    missingCostSales:report.rows.filter(row=>row.reason==="missing_cost_evidence").length,fees:"separate"};
}
