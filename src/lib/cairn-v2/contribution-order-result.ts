import type { SizedContributionOrder } from "../additional-contribution-order-sizing";
import type { ContributionOrderBasis, projectContributionOrderPlan } from "./contribution-order-plan";
import type { ReadyContribution } from "./planning-contract";

type Projection = ReturnType<typeof projectContributionOrderPlan>;
export type ContributionOrderRow = {
  row: ReadyContribution["rows"][number];
  quote?: ContributionOrderBasis["rows"][number];
  order?: SizedContributionOrder;
  issue: "basis_unavailable" | "quote_unavailable" | "no_feasible_combination" | "check_terms" | null;
};

// Join once by the account-specific allocation key. The amount plan remains
// available on row; executable principal and quantity come from the same order.
export function buildContributionOrderResult(strategy: ReadyContribution, basis: ContributionOrderBasis | undefined, projection: Projection | null, useCashLimits: boolean) {
  const outcome = projection?.result;
  const hasTargets = strategy.rows.some(row => row.allocationKrw > 0);
  const sizing = outcome && outcome.status !== "unavailable" && (!hasTargets || outcome.orders.length > 0) ? outcome : null;
  const quotes = new Map(basis?.rows.map(row => [row.key, row]));
  const orders = new Map(sizing?.orders.map(order => [order.key, order]));
  const rows = strategy.rows.map((row): ContributionOrderRow => {
    const quote = quotes.get(row.allocationKey);
    const order = orders.get(row.allocationKey);
    let issue: ContributionOrderRow["issue"] = null;
    if (row.allocationKrw > 0 && !order) {
      if (!basis) issue = "basis_unavailable";
      else if (!quote) issue = "quote_unavailable";
      else if (outcome?.status === "unavailable" && outcome.reason === "no_feasible_combination") issue = "no_feasible_combination";
      else issue = "check_terms";
    }
    return {row, quote, order, issue};
  }).sort((a, b) =>
    (b.order?.principalKrw ?? -1) - (a.order?.principalKrw ?? -1) ||
    b.row.allocationKrw - a.row.allocationKrw ||
    b.row.strategicAllocationKrw - a.row.strategicAllocationKrw ||
    (a.row.allocationKey ?? "").localeCompare(b.row.allocationKey ?? "")
  );
  const orderBudgetKrw = basis && sizing ? basis.budgetKrw : null;
  return {
    rows, sizing, orderBudgetKrw, useCashLimits,
    sales: projection?.sales ?? [], relaxed: projection?.relaxed ?? false,
    heldBackKrw: orderBudgetKrw === null ? null : strategy.cashAmountKrw - orderBudgetKrw,
  };
}
