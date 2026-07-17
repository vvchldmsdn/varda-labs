import type {
  InvestmentLabReturnEvidenceEvent,
  InvestmentLabReturnEvidenceSnapshot,
} from "./investment-lab-return-evidence.ts";
import type { InvestmentLabAmountProvenance } from "./investment-lab-execution-schedule.ts";
import type { InvestmentLabVooEvidenceResolution } from "./investment-lab-voo-evidence.ts";
import {
  buildInvestmentLabVooPath,
  type InvestmentLabVooPathBlocker,
} from "./investment-lab-voo-path.ts";
import {
  buildInvestmentLabVooReturnEstimate,
  type InvestmentLabVooReturnEstimate,
} from "./investment-lab-voo-return-estimate.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";

type ActualPathRow = Readonly<{
  serviceDate: string;
  totalMarketValueKrw: number;
}>;

type BoundaryFlow = Readonly<{
  eventDate: string;
  sequence: number;
  direction: "inflow" | "outflow";
  amountKrw: number;
  amountProvenance: InvestmentLabAmountProvenance;
}>;

export type InvestmentLabVooComparisonRow = Readonly<{
  serviceDate: string;
  actualMarketValueKrw: number;
  scenarioMarketValueKrw: number;
  differenceKrw: number;
  valuationPriceDate: string;
  hasPendingExecution: boolean;
}>;

export type InvestmentLabVooComparison =
  | Readonly<{
      status: "ready";
      summary: Readonly<{
        startServiceDate: string;
        endServiceDate: string;
        actualEndValueKrw: number;
        scenarioEndValueKrw: number;
        endDifferenceKrw: number;
        comparisonDateCount: number;
      }>;
      returnEstimate: InvestmentLabVooReturnEstimate;
      rows: readonly InvestmentLabVooComparisonRow[];
      coverage: Readonly<{
        appliedFlowRows: number;
        delayedExecutionRows: number;
        pendingComparisonRows: number;
        pendingAtEndRows: 0;
      }>;
      blockers: readonly [];
    }>
  | Readonly<{
      status: "unavailable";
      summary: null;
      returnEstimate: null;
      rows: readonly [];
      coverage: Readonly<{
        appliedFlowRows: 0;
        delayedExecutionRows: 0;
        pendingComparisonRows: 0;
        pendingAtEndRows: 0;
      }>;
      blockers: readonly string[];
    }>;

export function buildInvestmentLabVooComparison(input: {
  account?: PortfolioAccountScope;
  actualPath: readonly ActualPathRow[];
  boundaryFlows: readonly BoundaryFlow[];
  evidence: InvestmentLabVooEvidenceResolution;
  snapshotRows: readonly InvestmentLabReturnEvidenceSnapshot[];
  eventRows: readonly InvestmentLabReturnEvidenceEvent[];
}): InvestmentLabVooComparison {
  if (input.evidence.status !== "ready") {
    return unavailable(input.evidence.readiness.blockers);
  }
  const path = buildInvestmentLabVooPath({
    actualPath: input.actualPath,
    evidence: input.evidence,
  });
  if (path.status !== "ready") {
    return unavailable(path.blockers.map(pathBlockerReason));
  }
  if (path.pendingAtEnd.flowCount > 0) {
    return unavailable(["pending_flows_at_window_end"]);
  }

  const rows = Object.freeze(
    path.rows.map((row) =>
      Object.freeze({
        serviceDate: row.serviceDate,
        actualMarketValueKrw: row.actualMarketValueKrw,
        scenarioMarketValueKrw: row.investedMarketValueKrw,
        differenceKrw: row.valuationPathDifferenceKrw,
        valuationPriceDate: row.valuationPriceDate,
        hasPendingExecution:
          row.comparisonBasis ===
          "position_value_only_with_pending_flows",
      }),
    ),
  );
  const latest = rows.at(-1)!;
  const returnEstimate = buildInvestmentLabVooReturnEstimate({
    account: input.account,
    actualRows: input.actualPath,
    scenarioRows: path.rows,
    boundaryFlows: input.boundaryFlows,
    appliedFlows: path.appliedFlows,
    snapshotRows: input.snapshotRows,
    eventRows: input.eventRows,
  });

  return Object.freeze({
    status: "ready",
    summary: Object.freeze({
      startServiceDate: rows[0].serviceDate,
      endServiceDate: latest.serviceDate,
      actualEndValueKrw: latest.actualMarketValueKrw,
      scenarioEndValueKrw: latest.scenarioMarketValueKrw,
      endDifferenceKrw: latest.differenceKrw,
      comparisonDateCount: rows.length,
    }),
    returnEstimate,
    rows,
    coverage: Object.freeze({
      appliedFlowRows: path.appliedFlows.length,
      delayedExecutionRows: path.delayedExecutionRows,
      pendingComparisonRows: rows.filter((row) => row.hasPendingExecution)
        .length,
      pendingAtEndRows: 0 as const,
    }),
    blockers: [] as const,
  });
}

function unavailable(blockers: readonly string[]): InvestmentLabVooComparison {
  return Object.freeze({
    status: "unavailable",
    summary: null,
    returnEstimate: null,
    rows: [] as const,
    coverage: Object.freeze({
      appliedFlowRows: 0 as const,
      delayedExecutionRows: 0 as const,
      pendingComparisonRows: 0 as const,
      pendingAtEndRows: 0 as const,
    }),
    blockers: Object.freeze([...blockers].sort()),
  });
}

function pathBlockerReason(blocker: InvestmentLabVooPathBlocker) {
  return blocker.reason;
}
