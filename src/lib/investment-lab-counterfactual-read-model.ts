import { classifyInvestmentLabEvent } from "./investment-lab-event-flow.ts";
import {
  scheduleInvestmentLabBoundaryFlows,
  type InvestmentLabAmountProvenance,
} from "./investment-lab-execution-schedule.ts";
import { buildInvestmentLabCounterfactualPath } from "./investment-lab-counterfactual-path.ts";
import {
  buildInvestmentLabReturnEstimate,
  type InvestmentLabReturnEstimate,
} from "./investment-lab-return-estimate.ts";
import {
  resolveInvestmentLabVooEvidence,
  type InvestmentLabVooFxRow,
  type InvestmentLabVooReadiness,
} from "./investment-lab-voo-evidence.ts";
import {
  buildInvestmentLabVooComparison,
  type InvestmentLabVooComparison,
} from "./investment-lab-voo-comparison.ts";
import { buildInvestmentLabVooPath } from "./investment-lab-voo-path.ts";
import {
  buildInvestmentLabFixedMixScenario,
  type InvestmentLabFixedMixScenario,
} from "./investment-lab-fixed-mix.ts";
import type { InvestmentLabFixedMixSelection } from "./investment-lab-fixed-mix-selection.ts";
import {
  buildInvestmentLabContributionScenarioEvidence,
} from "./investment-lab-contribution-evidence.ts";
import {
  resolveInvestmentLabSourceSegmentAuthority,
  type InvestmentLabSourceSegmentAuthority,
} from "./investment-lab-source-segment-authority.ts";
import {
  buildInvestmentLabCashComparison,
  type InvestmentLabCashComparison,
} from "./investment-lab-cash-comparison.ts";
import {
  buildInvestmentLabObservedPath,
  type InvestmentLabObservedPath,
} from "./investment-lab-observed-path.ts";
import type {
  InvestmentLabContributionScenarioEvidence,
} from "./investment-lab-contribution-experiment.ts";
import { isRiskDate } from "./portfolio-risk-calendar.ts";
import {
  accountsForPortfolioScope,
  isNamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";

export type InvestmentLabSourceEventRow = Readonly<{
  legacyAssetId?: string | null;
  account?: string | null;
  eventDate: string;
  eventType: string;
  sequence: number;
  amountKrw: string | number | null;
  quantityDelta: string | number | null;
  price: string | number | null;
  fxRate: string | number | null;
  assetCurrency: string | null;
  isCorrection: boolean;
}>;

export type InvestmentLabSourceSnapshotRow = Readonly<{
  snapshotDate: string;
  account: string;
  cashValue: string | number | null;
  totalMarketValue: string | number | null;
  usdKrw: string | number | null;
  source: string | null;
  ruleVersion: string | null;
}>;

export type InvestmentLabSourceCloseRow = Readonly<{
  priceDate: string;
  closePrice: string | number | null;
  adjustedClosePrice: string | number | null;
  source: string | null;
}>;

export type InvestmentLabCounterfactualReadInput = Readonly<{
  eventRows: readonly InvestmentLabSourceEventRow[];
  snapshotRows: readonly InvestmentLabSourceSnapshotRow[];
  closeRows: readonly InvestmentLabSourceCloseRow[];
  vooCloseRows: readonly InvestmentLabSourceCloseRow[];
  fxRows: readonly InvestmentLabVooFxRow[];
}>;

export type InvestmentLabCounterfactualReadBlocker =
  | "snapshot_evidence_invalid"
  | "source_segment_authority_blocked"
  | "fount_scope_adjustment_blocked"
  | "actual_path_reconciliation_mismatch"
  | "actual_path_incomplete"
  | "event_account_unresolved"
  | "event_evidence_unsupported"
  | "scenario_close_evidence_invalid"
  | "flow_schedule_blocked"
  | "path_calculation_blocked"
  | "pending_flows_at_window_end"
  | "account_composition_incomplete"
  | "account_composition_mismatch";

export type InvestmentLabCounterfactualDisplayRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  scenarioMarketValueKrw: number;
  differenceKrw: number;
  valuationPriceDate: string;
  valuationCarryDays: number;
  hasPendingExecution: boolean;
}>;

export type InvestmentLabCounterfactualReadModel = Readonly<{
  status: "ready" | "blocked";
  observedPath: InvestmentLabObservedPath;
  scenario: Readonly<{
    account: PortfolioAccountScope;
    instrumentKey: "korea:KRW:069500";
    label: "KODEX 200";
    pathPolicyVersion: "position_flow_counterfactual_v1";
    executionPolicyVersion: "eod_adjusted_close_on_or_after_v1";
  }>;
  summary: Readonly<{
    startServiceDate: string;
    endServiceDate: string;
    actualEndValueKrw: number;
    scenarioEndValueKrw: number;
    endDifferenceKrw: number;
    comparisonDateCount: number;
  }> | null;
  returnEstimate: InvestmentLabReturnEstimate | null;
  vooReadiness: InvestmentLabVooReadiness | null;
  vooComparison: InvestmentLabVooComparison | null;
  cashComparison: InvestmentLabCashComparison | null;
  fixedMixScenario: InvestmentLabFixedMixScenario | null;
  contributionExperimentScenarios:
    readonly InvestmentLabContributionScenarioEvidence[];
  sourceAuthority: InvestmentLabSourceSegmentAuthority;
  rows: readonly InvestmentLabCounterfactualDisplayRow[];
  coverage: Readonly<{
    snapshotSourceRows: number;
    completeComparisonDates: number;
    incompleteSnapshotDates: number;
    eventSourceRows: number;
    eligibleFlowRows: number;
    appliedFlowRows: number;
    scenarioCloseRows: number;
    delayedExecutionRows: number;
    pendingComparisonRows: number;
    ignoredThroughAnchorRows: number;
    pendingAtEndRows: number;
    maxValuationCarryDays: number | null;
  }>;
  blockers: readonly InvestmentLabCounterfactualReadBlocker[];
}>;

export function buildInvestmentLabCounterfactualReadModel(
  input: InvestmentLabCounterfactualReadInput,
  options: Readonly<{
    account?: PortfolioAccountScope;
    fixedMixSelection?: InvestmentLabFixedMixSelection;
    fountScopeAdjustmentStatus?: "not_applicable" | "applied" | "blocked";
  }> = {},
): InvestmentLabCounterfactualReadModel {
  const account = options.account ?? "all";
  const baseBlockers = new Set<InvestmentLabCounterfactualReadBlocker>();
  const sourceAuthority = resolveInvestmentLabSourceSegmentAuthority(
    input.snapshotRows,
    account,
  );
  if (sourceAuthority.status !== "eligible") {
    baseBlockers.add("source_segment_authority_blocked");
  }
  if (options.fountScopeAdjustmentStatus === "blocked") {
    baseBlockers.add("fount_scope_adjustment_blocked");
  }
  const actual = buildActualPath(input.snapshotRows, account, baseBlockers);
  const flowResolution = resolveInvestmentLabBoundaryFlows(
    input.eventRows,
    account,
  );
  for (const blocker of flowResolution.blockers) baseBlockers.add(blocker);
  const events = flowResolution.flows;
  const kodexBlockers = new Set<InvestmentLabCounterfactualReadBlocker>();
  const closes = buildScenarioCloses(input.closeRows, kodexBlockers);

  const initialCoverage = coverage({
    actual,
    eventSourceRows: flowResolution.sourceRows.length,
    eligibleFlowRows: events.length,
    closeRows: closes.length,
  });
  const observedPath = buildInvestmentLabObservedPath({
    account,
    actualRows: actual.rows,
    boundaryFlows: events,
    snapshotRows: input.snapshotRows,
    eventRows: flowResolution.sourceRows,
    blockers: [...baseBlockers],
  });
  if (observedPath.status !== "ready") {
    return blockedReadModel(
      initialCoverage,
      baseBlockers,
      sourceAuthority,
      account,
      observedPath,
    );
  }

  const vooEvidence = resolveInvestmentLabVooEvidence({
    account,
    serviceDates: actual.rows.map((row) => row.serviceDate),
    priceRows: input.vooCloseRows,
    snapshotRows: input.snapshotRows,
    fxRows: input.fxRows,
    boundaryFlows: events,
  });
  const vooReadiness = vooEvidence.readiness;
  const vooComparison = buildInvestmentLabVooComparison({
    account,
    actualPath: actual.rows,
    boundaryFlows: events,
    evidence: vooEvidence,
    snapshotRows: input.snapshotRows,
    eventRows: flowResolution.sourceRows,
  });
  const cashComparison = buildInvestmentLabCashComparison({
    actualPath: actual.rows,
    boundaryFlows: events,
    actualReturnEstimate: observedPath.returnEstimate,
  });
  const vooOnlyContributionScenarios =
    buildInvestmentLabContributionScenarioEvidence({
      kodexRows: [],
      vooComparison,
      vooValuations: vooEvidence.valuations,
    });

  if (kodexBlockers.size > 0) {
    return blockedReadModel(
      initialCoverage,
      kodexBlockers,
      sourceAuthority,
      account,
      observedPath,
      {
        vooReadiness,
        vooComparison,
        cashComparison,
        fixedMixScenario: unavailableFixedMixScenario(
          options.fixedMixSelection,
          actual.rows,
          vooEvidence,
          vooComparison,
        ),
        contributionExperimentScenarios: vooOnlyContributionScenarios,
      },
    );
  }

  const windowEndPriceDate = closes.at(-1)?.priceDate ?? "invalid";
  const schedule = scheduleInvestmentLabBoundaryFlows({
    events,
    closes,
    windowEndPriceDate,
  });
  if (schedule.status !== "ready") {
    kodexBlockers.add("flow_schedule_blocked");
    return blockedReadModel(
      initialCoverage,
      kodexBlockers,
      sourceAuthority,
      account,
      observedPath,
      {
        vooReadiness,
        vooComparison,
        cashComparison,
        fixedMixScenario: unavailableFixedMixScenario(
          options.fixedMixSelection,
          actual.rows,
          vooEvidence,
          vooComparison,
        ),
        contributionExperimentScenarios: vooOnlyContributionScenarios,
      },
    );
  }

  const path = buildInvestmentLabCounterfactualPath({
    actualPath: actual.rows,
    closes,
    scheduledFlows: schedule.scheduledFlows,
  });
  if (path.status !== "ready") {
    kodexBlockers.add("path_calculation_blocked");
    return blockedReadModel(
      {
        ...initialCoverage,
        delayedExecutionRows: schedule.pendingFlowCount,
      },
      kodexBlockers,
      sourceAuthority,
      account,
      observedPath,
      {
        vooReadiness,
        vooComparison,
        cashComparison,
        fixedMixScenario: unavailableFixedMixScenario(
          options.fixedMixSelection,
          actual.rows,
          vooEvidence,
          vooComparison,
        ),
        contributionExperimentScenarios: vooOnlyContributionScenarios,
      },
    );
  }
  if (path.pendingAtEnd.flowCount > 0) {
    kodexBlockers.add("pending_flows_at_window_end");
    return blockedReadModel(
      {
        ...initialCoverage,
        delayedExecutionRows: schedule.pendingFlowCount,
        pendingAtEndRows: path.pendingAtEnd.flowCount,
      },
      kodexBlockers,
      sourceAuthority,
      account,
      observedPath,
      {
        vooReadiness,
        vooComparison,
        cashComparison,
        fixedMixScenario: unavailableFixedMixScenario(
          options.fixedMixSelection,
          actual.rows,
          vooEvidence,
          vooComparison,
        ),
        contributionExperimentScenarios: vooOnlyContributionScenarios,
      },
    );
  }

  const rows = Object.freeze(
    path.rows.map((row) =>
      Object.freeze({
        serviceDate: row.serviceDate,
        actualMarketValueKrw: row.actualMarketValueKrw,
        scenarioMarketValueKrw: row.investedMarketValueKrw,
        differenceKrw: row.valuationPathDifferenceKrw,
        valuationPriceDate: row.valuationPriceDate,
        valuationCarryDays: row.valuationCarryDays,
        hasPendingExecution:
          row.comparisonBasis ===
          "position_value_only_with_pending_flows",
      }),
    ),
  );
  const latest = rows.at(-1)!;
  const returnEstimate = buildInvestmentLabReturnEstimate({
    account,
    actualRows: actual.rows,
    scenarioRows: path.rows,
    boundaryFlows: events,
    appliedFlows: path.appliedFlows,
    priceRows: input.closeRows,
    snapshotRows: input.snapshotRows,
    eventRows: flowResolution.sourceRows,
  });
  const fixedMixScenario = options.fixedMixSelection
    ? buildInvestmentLabFixedMixScenario({
        selection: options.fixedMixSelection,
        actualPath: actual.rows,
        kodexPath: path,
        vooPath: buildInvestmentLabVooPath({
          actualPath: actual.rows,
          evidence: vooEvidence,
        }),
        kodexReturnEvidence: returnEstimate,
        vooReturnEvidence:
          vooComparison.status === "ready"
            ? vooComparison.returnEstimate
            : null,
      })
    : null;
  const contributionExperimentScenarios =
    buildInvestmentLabContributionScenarioEvidence({
      kodexRows: path.rows,
      vooComparison,
      vooValuations: vooEvidence.valuations,
    });

  return Object.freeze({
    status: "ready",
    observedPath,
    scenario: scenario(account),
    summary: Object.freeze({
      startServiceDate: rows[0].serviceDate,
      endServiceDate: latest.serviceDate,
      actualEndValueKrw: latest.actualMarketValueKrw,
      scenarioEndValueKrw: latest.scenarioMarketValueKrw,
      endDifferenceKrw: latest.differenceKrw,
      comparisonDateCount: rows.length,
    }),
    returnEstimate,
    vooReadiness,
    vooComparison,
    cashComparison,
    fixedMixScenario,
    contributionExperimentScenarios,
    sourceAuthority,
    rows,
    coverage: Object.freeze({
      ...initialCoverage,
      delayedExecutionRows: schedule.pendingFlowCount,
      appliedFlowRows: path.appliedFlows.length,
      pendingComparisonRows: rows.filter((row) => row.hasPendingExecution)
        .length,
      ignoredThroughAnchorRows: path.ignoredFlows.throughAnchor,
      pendingAtEndRows: path.pendingAtEnd.flowCount,
      maxValuationCarryDays: Math.max(
        ...rows.map((row) => row.valuationCarryDays),
      ),
    }),
    blockers: Object.freeze([]),
  });
}

function buildActualPath(
  sourceRows: readonly InvestmentLabSourceSnapshotRow[],
  accountScope: PortfolioAccountScope,
  blockers: Set<InvestmentLabCounterfactualReadBlocker>,
) {
  const selectedAccounts = accountsForPortfolioScope(accountScope);
  const byDate = new Map<string, Map<string, number>>();
  let sourceRowCount = 0;

  for (const row of sourceRows) {
    const account = String(row.account ?? "").trim().toLowerCase();
    const relevant =
      accountScope === "all"
        ? isNamedPortfolioAccount(account) || account === "all"
        : account === accountScope;
    if (!relevant) {
      if (
        accountScope === "all" &&
        account !== "all" &&
        !isNamedPortfolioAccount(account)
      ) {
        blockers.add("snapshot_evidence_invalid");
      }
      continue;
    }
    sourceRowCount += 1;
    const value = nonNegativeNumber(row.totalMarketValue);
    if (
      !isRiskDate(row.snapshotDate) ||
      value === null
    ) {
      blockers.add("snapshot_evidence_invalid");
      continue;
    }

    const accountValues = byDate.get(row.snapshotDate) ?? new Map();
    if (accountValues.has(account)) {
      blockers.add("snapshot_evidence_invalid");
      continue;
    }
    accountValues.set(account, value);
    byDate.set(row.snapshotDate, accountValues);
  }

  const rows = [...byDate]
    .filter(([, accountValues]) =>
      selectedAccounts.every((account) => accountValues.has(account)),
    )
    .map(([serviceDate, accountValues]) => {
      const totalMarketValueKrw = selectedAccounts.reduce(
        (sum, account) => sum + accountValues.get(account)!,
        0,
      );
      const storedAll = accountValues.get("all");
      if (
        accountScope === "all" &&
        storedAll !== undefined &&
        Math.abs(storedAll - totalMarketValueKrw) > 1e-6
      ) {
        blockers.add("actual_path_reconciliation_mismatch");
      }
      return { serviceDate, totalMarketValueKrw };
    })
    .sort((left, right) => left.serviceDate.localeCompare(right.serviceDate));

  const incompleteDates = [...byDate.values()].filter(
    (accountValues) =>
      !selectedAccounts.every((account) => accountValues.has(account)),
  ).length;
  if (rows.length < 2 || incompleteDates > 0) {
    blockers.add("actual_path_incomplete");
  }

  return {
    rows,
    sourceRows: sourceRowCount,
    completeDates: rows.length,
    incompleteDates,
  };
}

function buildBoundaryFlows(
  sourceRows: readonly InvestmentLabSourceEventRow[],
  blockers: Set<InvestmentLabCounterfactualReadBlocker>,
) {
  const flows = [];

  for (const row of sourceRows) {
    const resolved = resolveEventAmount(row);
    const classification = classifyInvestmentLabEvent({
      eventType: row.eventType,
      amountResolved: resolved !== null,
      isCorrection: row.isCorrection,
    });

    if (classification.category === "unsupported") {
      blockers.add("event_evidence_unsupported");
      continue;
    }
    if (!classification.includedInV1) continue;
    if (!classification.direction || !resolved) {
      blockers.add("event_evidence_unsupported");
      continue;
    }

    flows.push({
      eventDate: row.eventDate,
      sequence: row.sequence,
      direction: classification.direction,
      amountKrw: resolved.amountKrw,
      amountProvenance: resolved.provenance,
    });
  }

  return flows;
}

export function resolveInvestmentLabBoundaryFlows(
  sourceRows: readonly InvestmentLabSourceEventRow[],
  account: PortfolioAccountScope = "all",
) {
  const blockers = new Set<InvestmentLabCounterfactualReadBlocker>();
  const scopedRows = selectAccountEventRows(sourceRows, account, blockers);
  const flows = buildBoundaryFlows(scopedRows, blockers);
  return Object.freeze({
    status: blockers.size === 0 ? "ready" : "blocked",
    sourceRows: Object.freeze(scopedRows),
    flows: Object.freeze(flows),
    blockers: Object.freeze([...blockers].sort()),
  });
}

function selectAccountEventRows(
  sourceRows: readonly InvestmentLabSourceEventRow[],
  account: PortfolioAccountScope,
  blockers: Set<InvestmentLabCounterfactualReadBlocker>,
) {
  if (account === "all") return [...sourceRows];

  const selected: InvestmentLabSourceEventRow[] = [];
  for (const row of sourceRows) {
    const rowAccount = String(row.account ?? "").trim().toLowerCase();
    if (rowAccount === account) {
      selected.push(row);
      continue;
    }
    if (isNamedPortfolioAccount(rowAccount)) continue;

    const resolved = resolveEventAmount(row);
    const classification = classifyInvestmentLabEvent({
      eventType: row.eventType,
      amountResolved: resolved !== null,
      isCorrection: row.isCorrection,
    });
    if (
      classification.category === "unsupported" ||
      classification.category === "invested_boundary_flow" ||
      classification.category === "cash_ledger_only" ||
      (classification.category === "position_metadata" &&
        hasEventFinancialPayload(row))
    ) {
      blockers.add("event_account_unresolved");
    }
  }
  return selected;
}

function hasEventFinancialPayload(row: InvestmentLabSourceEventRow) {
  return [row.amountKrw, row.quantityDelta, row.price, row.fxRate].some(
    (value) => {
      if (value === null || value === "") return false;
      const parsed = Number(value);
      return !Number.isFinite(parsed) || Math.abs(parsed) > 1e-8;
    },
  );
}

function buildScenarioCloses(
  sourceRows: readonly InvestmentLabSourceCloseRow[],
  blockers: Set<InvestmentLabCounterfactualReadBlocker>,
) {
  const closes = sourceRows.map((row) => ({
    priceDate: row.priceDate,
    adjustedClose: positiveNumber(row.adjustedClosePrice) ?? 0,
  }));
  if (
    closes.length < 2 ||
    closes.some(
      (row) => !isRiskDate(row.priceDate) || row.adjustedClose <= 0,
    )
  ) {
    blockers.add("scenario_close_evidence_invalid");
  }
  return closes.sort((left, right) =>
    left.priceDate.localeCompare(right.priceDate),
  );
}

function resolveEventAmount(row: InvestmentLabSourceEventRow): Readonly<{
  amountKrw: number;
  provenance: InvestmentLabAmountProvenance;
}> | null {
  const explicitAmount = absolutePositiveNumber(row.amountKrw);
  if (explicitAmount !== null) {
    return Object.freeze({
      amountKrw: explicitAmount,
      provenance: "explicit_amount_krw",
    });
  }

  const quantity = absolutePositiveNumber(row.quantityDelta);
  const price = positiveNumber(row.price);
  if (quantity === null || price === null) return null;

  const localValue = quantity * price;
  if (!Number.isFinite(localValue) || localValue <= 0) return null;
  if (String(row.assetCurrency ?? "").trim().toUpperCase() === "KRW") {
    return Object.freeze({
      amountKrw: localValue,
      provenance: "derived_quantity_price_krw",
    });
  }

  const fxRate = positiveNumber(row.fxRate);
  if (fxRate === null) return null;
  const amountKrw = localValue * fxRate;
  return Number.isFinite(amountKrw) && amountKrw > 0
    ? Object.freeze({
        amountKrw,
        provenance: "derived_quantity_price_fx",
      })
    : null;
}

function coverage({
  actual,
  eventSourceRows,
  eligibleFlowRows,
  closeRows,
}: {
  actual: {
    sourceRows: number;
    completeDates: number;
    incompleteDates: number;
  };
  eventSourceRows: number;
  eligibleFlowRows: number;
  closeRows: number;
}) {
  return {
    snapshotSourceRows: actual.sourceRows,
    completeComparisonDates: actual.completeDates,
    incompleteSnapshotDates: actual.incompleteDates,
    eventSourceRows,
    eligibleFlowRows,
    appliedFlowRows: 0,
    scenarioCloseRows: closeRows,
    delayedExecutionRows: 0,
    pendingComparisonRows: 0,
    ignoredThroughAnchorRows: 0,
    pendingAtEndRows: 0,
    maxValuationCarryDays: null,
  } as const;
}

function blockedReadModel(
  coverageValue: InvestmentLabCounterfactualReadModel["coverage"],
  blockers: Set<InvestmentLabCounterfactualReadBlocker>,
  sourceAuthority: InvestmentLabSourceSegmentAuthority,
  account: PortfolioAccountScope,
  observedPath: InvestmentLabObservedPath,
  available: Readonly<{
    vooReadiness?: InvestmentLabVooReadiness | null;
    vooComparison?: InvestmentLabVooComparison | null;
    cashComparison?: InvestmentLabCashComparison | null;
    fixedMixScenario?: InvestmentLabFixedMixScenario | null;
    contributionExperimentScenarios?: readonly InvestmentLabContributionScenarioEvidence[];
  }> = {},
): InvestmentLabCounterfactualReadModel {
  return Object.freeze({
    status: "blocked",
    observedPath,
    scenario: scenario(account),
    summary: null,
    returnEstimate: null,
    vooReadiness: available.vooReadiness ?? null,
    vooComparison: available.vooComparison ?? null,
    cashComparison: available.cashComparison ?? null,
    fixedMixScenario: available.fixedMixScenario ?? null,
    contributionExperimentScenarios: Object.freeze([
      ...(available.contributionExperimentScenarios ?? []),
    ]),
    sourceAuthority,
    rows: Object.freeze([]),
    coverage: Object.freeze({ ...coverageValue }),
    blockers: Object.freeze([...blockers].sort()),
  });
}

function unavailableFixedMixScenario(
  selection: InvestmentLabFixedMixSelection | undefined,
  actualPath: readonly Readonly<{
    serviceDate: string;
    totalMarketValueKrw: number;
  }>[],
  vooEvidence: ReturnType<typeof resolveInvestmentLabVooEvidence>,
  vooComparison: InvestmentLabVooComparison,
) {
  if (!selection) return null;
  return buildInvestmentLabFixedMixScenario({
    selection,
    actualPath,
    kodexPath: Object.freeze({
      status: "unavailable",
      rows: [] as const,
      appliedFlows: [] as const,
    }),
    vooPath: buildInvestmentLabVooPath({
      actualPath,
      evidence: vooEvidence,
    }),
    kodexReturnEvidence: null,
    vooReturnEvidence:
      vooComparison.status === "ready"
        ? vooComparison.returnEstimate
        : null,
  });
}

function scenario(account: PortfolioAccountScope) {
  return Object.freeze({
    account,
    instrumentKey: "korea:KRW:069500",
    label: "KODEX 200",
    pathPolicyVersion: "position_flow_counterfactual_v1",
    executionPolicyVersion: "eod_adjusted_close_on_or_after_v1",
  } as const);
}

function positiveNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function absolutePositiveNumber(value: string | number | null) {
  if (value === null || value === "") return null;
  const parsed = Math.abs(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
