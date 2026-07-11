import { assessInvestmentLabCounterfactualReadiness } from "../../src/lib/investment-lab-counterfactual-readiness.ts";
import {
  mapRiskEvidenceDateToServiceDate,
  shiftRiskDate,
} from "../../src/lib/portfolio-risk-calendar.ts";
import { portfolioEventAccount } from "../../src/lib/portfolio-return-metrics-core.ts";

const ACCOUNTS = ["brokerage", "isa", "irp", "all"];

export function auditInvestmentLabCounterfactualEvidence({
  snapshotRows,
  tradeRows,
  priceRows,
  fxRows,
}) {
  const allSnapshotRow = snapshotRows.find((row) => row.account === "all");
  const snapshotsByAccount = new Map(
    snapshotRows.map((row) => [row.account, toRangeEvidence(row)]),
  );
  const resolvedTrades = tradeRows.map(resolveTradeAccount);
  const scenarios = priceRows.map((row) => ({
    instrumentKey: `${row.market}:${row.currency}:${row.ticker}`,
    currency: row.currency,
    prices: toRangeEvidence(row),
  }));

  const accounts = ACCOUNTS.map((account) =>
    assessAccount({
      account,
      snapshots: snapshotsByAccount.get(account) ?? emptyRangeEvidence(),
      resolvedTrades,
      scenarios,
      fxRows,
    }),
  );
  const storedAllRows = number(allSnapshotRow?.stored_all_rows);
  const storedAccountRows = snapshotRows
    .filter((row) => row.account !== "all")
    .reduce((total, row) => total + number(row.row_count), 0);

  return {
    audit: "investment_lab_historical_counterfactual_readiness",
    status: "passed",
    readOnly: true,
    primaryScenario: "all_kodex200_with_same_trade_schedule",
    baseline: accounts.map(kodexBaseline),
    evidence: {
      storedPortfolioSnapshotRows: storedAccountRows + storedAllRows,
      storedAccountSnapshotRows: storedAccountRows,
      derivedAllSnapshotRows: number(allSnapshotRow?.derived_all_rows),
      portfolioSnapshotDates: Math.max(
        0,
        ...snapshotRows.map((row) => number(row.distinct_dates)),
      ),
      tradeRows: resolvedTrades.length,
      scenarioInstruments: scenarios.length,
      scenarioPriceRows: sum(priceRows, "row_count"),
      fxRows: fxRows.length,
      fxDates: countDates(fxRows.map((row) => row.rate_date)).size,
      allSnapshotReconciliation: {
        storedRows: storedAllRows,
        derivedRows: number(allSnapshotRow?.derived_all_rows),
        overlapDates: number(allSnapshotRow?.overlap_dates),
        mismatchDates: number(allSnapshotRow?.reconciliation_mismatch_rows),
      },
    },
    accounts,
    boundaries: {
      providerCalls: 0,
      databaseWrites: 0,
      schemaChanges: 0,
      routesEnabled: 0,
    },
  };
}

function assessAccount({ account, snapshots, resolvedTrades, scenarios, fxRows }) {
  const trades = buildTradeEvidence(resolvedTrades, account, snapshots);
  const fx = buildFxEvidence(fxRows, snapshots);
  const scenarioResults = scenarios.map((scenario) => ({
    instrumentKey: scenario.instrumentKey,
    currency: scenario.currency,
    priceRows: scenario.prices.rowCount,
    priceDates: scenario.prices.distinctDates,
    priceStartDate: scenario.prices.startDate,
    priceEndDate: scenario.prices.endDate,
    ...assessInvestmentLabCounterfactualReadiness({
      account,
      snapshots,
      trades,
      scenario,
      fx,
    }),
  }));
  const kodex200 = scenarioResults.find((row) =>
    row.instrumentKey.endsWith(":069500"),
  );

  return {
    account,
    snapshots,
    trades,
    fx,
    scenarioReadiness: summarizeScenarios(scenarioResults),
    kodex200: projectScenario(kodex200),
  };
}

function resolveTradeAccount(row) {
  return {
    eventDate: row.event_date,
    amountResolved: row.amount_resolved,
    isCorrection: row.is_correction,
    account: normalizeAccount(
      portfolioEventAccount({
        account: row.account,
        beforeValue: row.before_value,
        afterValue: row.after_value,
      }) ?? row.asset_account,
    ),
  };
}

function buildTradeEvidence(rows, account, snapshots) {
  if (!snapshots.startDate || !snapshots.endDate) {
    return emptyTradeEvidence();
  }

  const inRange = rows.filter(
    (row) =>
      row.eventDate > snapshots.startDate &&
      row.eventDate <= snapshots.endDate,
  );
  const selected =
    account === "all"
      ? inRange
      : inRange.filter(
          (row) => row.account === account || row.account === "unknown",
        );

  return {
    rowCount: selected.length,
    unresolvedAmountRows: selected.filter((row) => !row.amountResolved).length,
    unknownAccountRows:
      account === "all"
        ? 0
        : selected.filter((row) => row.account === "unknown").length,
    correctionRows: selected.filter((row) => row.isCorrection).length,
  };
}

function buildFxEvidence(rows, snapshots) {
  if (!snapshots.startDate || !snapshots.endDate) {
    return emptyRangeEvidence();
  }

  const scanStart = shiftRiskDate(snapshots.startDate, -3);
  const selected = rows.filter((row) => {
    const serviceDate = mapRiskEvidenceDateToServiceDate(row.rate_date);
    return serviceDate >= scanStart && serviceDate <= snapshots.endDate;
  });
  const dates = selected.map((row) => row.rate_date);
  const counts = countDates(dates);

  return {
    rowCount: selected.length,
    distinctDates: counts.size,
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
    duplicateDateGroups: [...counts.values()].filter((count) => count > 1).length,
    invalidRows: selected.filter((row) => !row.valid).length,
  };
}

function kodexBaseline(account) {
  const scenario = account.kodex200;
  return {
    account: account.account,
    status: scenario?.status ?? "blocked",
    blockers: scenario?.blockers ?? ["insufficient_scenario_prices"],
    productionEngineReady: scenario?.productionEngineReady ?? false,
    unresolvedPolicyGates: scenario?.unresolvedPolicyGates ?? [],
  };
}

function summarizeScenarios(scenarios) {
  const blockerCounts = {};
  for (const scenario of scenarios) {
    for (const blocker of scenario.blockers) {
      blockerCounts[blocker] = (blockerCounts[blocker] ?? 0) + 1;
    }
  }

  return {
    total: scenarios.length,
    readyForFixture: scenarios.filter(
      (scenario) => scenario.status === "ready_for_engine_fixture",
    ).length,
    blocked: scenarios.filter((scenario) => scenario.status === "blocked").length,
    blockerCounts,
  };
}

function projectScenario(scenario) {
  if (!scenario) return null;
  return {
    instrumentKey: scenario.instrumentKey,
    currency: scenario.currency,
    priceRows: scenario.priceRows,
    priceDates: scenario.priceDates,
    priceStartDate: scenario.priceStartDate,
    priceEndDate: scenario.priceEndDate,
    status: scenario.status,
    blockers: scenario.blockers,
    coverageBasis: scenario.coverageBasis,
    productionEngineReady: scenario.productionEngineReady,
    unresolvedPolicyGates: scenario.unresolvedPolicyGates,
  };
}

function normalizeAccount(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ACCOUNTS.includes(normalized) && normalized !== "all"
    ? normalized
    : "unknown";
}

function toRangeEvidence(row) {
  return {
    rowCount: number(row.row_count),
    distinctDates: number(row.distinct_dates),
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    duplicateDateGroups: number(row.duplicate_date_groups),
    invalidRows: number(row.invalid_rows),
    reconciliationMismatchRows: number(row.reconciliation_mismatch_rows),
  };
}

function emptyRangeEvidence() {
  return {
    rowCount: 0,
    distinctDates: 0,
    startDate: null,
    endDate: null,
    duplicateDateGroups: 0,
    invalidRows: 0,
    reconciliationMismatchRows: 0,
  };
}

function emptyTradeEvidence() {
  return {
    rowCount: 0,
    unresolvedAmountRows: 0,
    unknownAccountRows: 0,
    correctionRows: 0,
  };
}

function countDates(dates) {
  const counts = new Map();
  for (const date of dates) counts.set(date, (counts.get(date) ?? 0) + 1);
  return counts;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + number(row[key]), 0);
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
