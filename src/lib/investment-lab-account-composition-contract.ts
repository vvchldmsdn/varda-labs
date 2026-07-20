import type { InvestmentLabAnchorBasketScenario } from "./investment-lab-anchor-basket-scenario.ts";
import type { InvestmentLabAnchorValueWeightScenario } from "./investment-lab-anchor-value-weight-scenario.ts";
import type { InvestmentLabCounterfactualReadModel } from "./investment-lab-counterfactual-read-model.ts";
import {
  NAMED_PORTFOLIO_ACCOUNTS,
  type NamedPortfolioAccount,
} from "./portfolio-account-scope.ts";

export const INVESTMENT_LAB_ACCOUNT_COMPOSITION_POLICY = Object.freeze({
  version: "named_account_path_sum_v1",
  accounts: NAMED_PORTFOLIO_ACCOUNTS,
  allAuthority: "sum_of_complete_named_account_paths",
  partialAccountSum: "forbidden",
  fountAdjustment: "apply_once_before_named_account_calculation",
  assumptions: Object.freeze({
    fractionalUnits: true,
    transactionCostsKrw: 0,
    taxKrw: 0,
    fxSpreadKrw: 0,
    shortSelling: "forbidden",
  }),
} as const);

export type InvestmentLabAccountCompositionScenarioId =
  | "actual"
  | "kodex200"
  | "voo"
  | "zero_return"
  | "fixed_mix"
  | "anchor_basket"
  | "anchor_value_weight";

export type InvestmentLabAccountCompositionBlocker =
  | "named_account_model_unavailable"
  | "named_account_scenario_unavailable"
  | "service_date_axis_mismatch"
  | "aggregate_value_mismatch"
  | "flow_count_mismatch"
  | "pooled_scenario_unavailable"
  | "return_calculation_unavailable";

export type InvestmentLabAccountCompositionScenarioResolution = Readonly<{
  status: "ready" | "unavailable" | "not_requested";
  blockers: readonly InvestmentLabAccountCompositionBlocker[];
}>;

export type InvestmentLabAccountComposition = Readonly<{
  status: "ready" | "partial" | "unavailable" | "not_applicable";
  policy: typeof INVESTMENT_LAB_ACCOUNT_COMPOSITION_POLICY;
  scenarios: Readonly<
    Record<
      InvestmentLabAccountCompositionScenarioId,
      InvestmentLabAccountCompositionScenarioResolution
    >
  >;
}>;

export type InvestmentLabNamedModels = Readonly<
  Record<NamedPortfolioAccount, InvestmentLabCounterfactualReadModel>
>;

export type InvestmentLabNamedAnchors = Readonly<
  Record<NamedPortfolioAccount, InvestmentLabAnchorBasketScenario>
>;

export type InvestmentLabNamedAnchorValueWeights = Readonly<
  Record<NamedPortfolioAccount, InvestmentLabAnchorValueWeightScenario>
>;

export type InvestmentLabCompositionBoundaryFlow = Readonly<{
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
}>;

export type InvestmentLabComposableRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  scenarioMarketValueKrw: number;
  differenceKrw: number;
  hasPendingExecution: boolean;
}>;

export type InvestmentLabComposedRows = Readonly<{
  status: "ready" | "unavailable";
  rows: readonly InvestmentLabComposableRow[];
  blockers: readonly InvestmentLabAccountCompositionBlocker[];
}>;

export type InvestmentLabCompositionValue<T> =
  | Readonly<{
      status: "ready";
      value: T;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      value: null;
      blockers: readonly InvestmentLabAccountCompositionBlocker[];
    }>
  | Readonly<{
      status: "not_requested";
      value: null;
      blockers: readonly [];
    }>;

export function composeInvestmentLabAccountRows(
  rowsFor: (account: NamedPortfolioAccount) => readonly InvestmentLabComposableRow[],
): InvestmentLabComposedRows {
  const named = NAMED_PORTFOLIO_ACCOUNTS.map((account) => rowsFor(account));
  const axis = named[0].map((row) => row.serviceDate);
  if (
    axis.length < 2 ||
    named.some(
      (rows) =>
        rows.length !== axis.length ||
        rows.some((row, index) => row.serviceDate !== axis[index]),
    )
  ) {
    return Object.freeze({
      status: "unavailable",
      rows: [] as const,
      blockers: ["service_date_axis_mismatch"] as const,
    });
  }

  const rows = axis.map((serviceDate, index) => {
    const accountRows = named.map((accountRows) => accountRows[index]);
    const actualMarketValueKrw = compensatedSum(
      accountRows.map((row) => row.actualMarketValueKrw),
    );
    const scenarioMarketValueKrw = compensatedSum(
      accountRows.map((row) => row.scenarioMarketValueKrw),
    );
    return Object.freeze({
      serviceDate,
      actualMarketValueKrw,
      scenarioMarketValueKrw,
      differenceKrw: scenarioMarketValueKrw - actualMarketValueKrw,
      hasPendingExecution: accountRows.some((row) => row.hasPendingExecution),
    });
  });
  if (
    rows.some(
      (row) =>
        !Number.isFinite(row.actualMarketValueKrw) ||
        !Number.isFinite(row.scenarioMarketValueKrw) ||
        row.actualMarketValueKrw < 0 ||
        row.scenarioMarketValueKrw < 0,
    )
  ) {
    return Object.freeze({
      status: "unavailable",
      rows: [] as const,
      blockers: ["aggregate_value_mismatch"] as const,
    });
  }
  return Object.freeze({
    status: "ready",
    rows: Object.freeze(rows),
    blockers: [] as const,
  });
}

export function investmentLabCompositionRowsMatch(
  composed: readonly InvestmentLabComposableRow[],
  pooled: readonly InvestmentLabComposableRow[],
) {
  return (
    composed.length === pooled.length &&
    composed.every(
      (row, index) =>
        row.serviceDate === pooled[index].serviceDate &&
        investmentLabCompositionNumbersMatch(
          row.actualMarketValueKrw,
          pooled[index].actualMarketValueKrw,
        ) &&
        investmentLabCompositionNumbersMatch(
          row.scenarioMarketValueKrw,
          pooled[index].scenarioMarketValueKrw,
        ) &&
        investmentLabCompositionNumbersMatch(
          row.differenceKrw,
          pooled[index].differenceKrw,
        ),
    )
  );
}

export function investmentLabCompositionActualRowsMatchModel(
  composed: readonly InvestmentLabComposableRow[],
  pooled: readonly Readonly<{
    serviceDate: string;
    actualMarketValueKrw: number;
  }>[],
) {
  const pooledByDate = new Map(
    pooled.map((row) => [row.serviceDate, row.actualMarketValueKrw]),
  );
  return composed.every((row) => {
    const value = pooledByDate.get(row.serviceDate);
    return (
      value !== undefined &&
      investmentLabCompositionNumbersMatch(row.actualMarketValueKrw, value)
    );
  });
}

export function summarizeInvestmentLabCompositionRows(
  rows: readonly InvestmentLabComposableRow[],
) {
  const first = rows[0];
  const latest = rows.at(-1)!;
  return Object.freeze({
    startServiceDate: first.serviceDate,
    endServiceDate: latest.serviceDate,
    actualEndValueKrw: latest.actualMarketValueKrw,
    scenarioEndValueKrw: latest.scenarioMarketValueKrw,
    endDifferenceKrw: latest.differenceKrw,
    comparisonDateCount: rows.length,
  });
}

export function sumInvestmentLabNamedModels(
  named: InvestmentLabNamedModels,
  read: (model: InvestmentLabCounterfactualReadModel) => number,
) {
  return compensatedSum(
    NAMED_PORTFOLIO_ACCOUNTS.map((account) => read(named[account])),
  );
}

export function compensatedSum(values: readonly number[]) {
  let total = 0;
  let compensation = 0;
  for (const value of values) {
    const next = total + value;
    compensation +=
      Math.abs(total) >= Math.abs(value)
        ? total - next + value
        : value - next + total;
    total = next;
  }
  return total + compensation;
}

export function readyInvestmentLabCompositionValue<T>(
  value: T,
): InvestmentLabCompositionValue<T> {
  return Object.freeze({ status: "ready", value, blockers: [] as const });
}

export function unavailableInvestmentLabCompositionValue<T>(
  blockers: readonly InvestmentLabAccountCompositionBlocker[],
): InvestmentLabCompositionValue<T> {
  return Object.freeze({
    status: "unavailable",
    value: null,
    blockers: Object.freeze([...new Set(blockers)].sort()),
  });
}

export function notRequestedInvestmentLabCompositionValue<T>(): InvestmentLabCompositionValue<T> {
  return Object.freeze({
    status: "not_requested",
    value: null,
    blockers: [] as const,
  });
}

function investmentLabCompositionNumbersMatch(
  left: number,
  right: number,
  tolerance = 1e-8,
) {
  return (
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    Math.abs(left - right) <=
      tolerance * Math.max(1, Math.abs(left), Math.abs(right))
  );
}
