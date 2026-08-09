import {
  planSimulationHistoryCompletion,
  type SimulationHistoryCompletionPlan,
  type SimulationHistoryHoldingInput,
} from "./simulation-history-completion.ts";

export const INVESTMENT_LAB_STRESS_HISTORY_WRITE_CONFIRMATION =
  "--confirm-investment-lab-stress-history-write";
export const INVESTMENT_LAB_STRESS_FX_WRITE_CONFIRMATION =
  "--confirm-investment-lab-stress-fx-write";

export const INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY = Object.freeze({
  version: "investment_lab_stress_history_completion_v1",
  providerInstanceCount: 1,
  tokenReuseBoundary: "single_process_provider_session",
  retryCount: 0,
  fxWriteMode: "insert_only_when_no_row_exists_for_date",
  benchmarkTargets: Object.freeze([
    Object.freeze({ market: "korea", currency: "KRW", ticker: "069500" }),
    Object.freeze({ market: "us", currency: "USD", ticker: "VOO" }),
  ]),
  ranges: Object.freeze([
    Object.freeze({ id: "covid_selloff", startDate: "2020-02-12", endDate: "2020-03-23" }),
    Object.freeze({ id: "rate_shock_2022_a", startDate: "2021-12-27", endDate: "2022-06-24" }),
    Object.freeze({ id: "rate_shock_2022_b", startDate: "2022-06-25", endDate: "2022-10-14" }),
    Object.freeze({ id: "ai_rally_2023_a", startDate: "2022-12-27", endDate: "2023-06-24" }),
    Object.freeze({ id: "ai_rally_2023_b", startDate: "2023-06-25", endDate: "2023-07-31" }),
  ]),
  fxRange: Object.freeze({ startDate: "2020-02-12", endDate: "2023-07-31" }),
} as const);

export type InvestmentLabStressHistoryCommandMode =
  | "plan_only"
  | "provider_dry_run"
  | "write"
  | "fx_write";

export function parseInvestmentLabStressHistoryCommandArgs(
  args: readonly string[],
) {
  let providerDryRun = false;
  let write = false;
  let confirmed = false;
  let fxWrite = false;
  let fxConfirmed = false;
  for (const arg of args) {
    if (arg === "--provider-dry-run") providerDryRun = true;
    else if (arg === "--write") write = true;
    else if (arg === "--fx-write") fxWrite = true;
    else if (arg === INVESTMENT_LAB_STRESS_HISTORY_WRITE_CONFIRMATION) {
      confirmed = true;
    } else if (arg === INVESTMENT_LAB_STRESS_FX_WRITE_CONFIRMATION) {
      fxConfirmed = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (providerDryRun && (write || confirmed || fxWrite || fxConfirmed)) {
    throw new Error("--provider-dry-run cannot be combined with write flags");
  }
  if ((write || confirmed) && (fxWrite || fxConfirmed)) {
    throw new Error("full and FX-only write flags cannot be combined");
  }
  if (write !== confirmed) {
    throw new Error(
      `writes require both --write and ${INVESTMENT_LAB_STRESS_HISTORY_WRITE_CONFIRMATION}`,
    );
  }
  if (fxWrite !== fxConfirmed) {
    throw new Error(
      `FX-only writes require both --fx-write and ${INVESTMENT_LAB_STRESS_FX_WRITE_CONFIRMATION}`,
    );
  }
  return Object.freeze({
    mode: (write
      ? "write"
      : fxWrite
        ? "fx_write"
      : providerDryRun
        ? "provider_dry_run"
        : "plan_only") as InvestmentLabStressHistoryCommandMode,
  });
}

export function planInvestmentLabStressHistoryCompletion({
  holdings,
}: {
  holdings: readonly SimulationHistoryHoldingInput[];
}) {
  const completionHoldings = withBenchmarkTargets(holdings);
  const plans = INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.ranges.map(
    (range) =>
      Object.freeze({
        id: range.id,
        plan: planSimulationHistoryCompletion({
          startDate: range.startDate,
          endDate: range.endDate,
          holdings: completionHoldings,
        }),
      }),
  );
  return Object.freeze({
    policy: INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY,
    plans: Object.freeze(plans),
  });
}

function withBenchmarkTargets(
  holdings: readonly SimulationHistoryHoldingInput[],
) {
  const rows = holdings.map((holding) => ({ ...holding }));
  const existingKeys = new Set(
    rows.map((row) =>
      [
        row.market?.trim().toLowerCase(),
        row.currency?.trim().toUpperCase(),
        row.ticker?.trim().toUpperCase(),
      ].join("|"),
    ),
  );
  for (const benchmark of INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.benchmarkTargets) {
    const key = `${benchmark.market}|${benchmark.currency}|${benchmark.ticker}`;
    if (existingKeys.has(key)) continue;
    rows.push({
      accountCode: "brokerage",
      market: benchmark.market,
      currency: benchmark.currency,
      ticker: benchmark.ticker,
      quantity: 1,
    });
  }
  return rows;
}

export type InvestmentLabStressHistoryPlan = Readonly<{
  id: string;
  plan: SimulationHistoryCompletionPlan;
}>;
