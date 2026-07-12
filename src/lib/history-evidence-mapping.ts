import {
  summarizeHistoricalEvidenceForConsumer,
  type HistoricalEvidenceClassification,
  type HistoricalEvidenceKind,
  type HistoricalEvidenceRequirement,
} from "./historical-evidence-completeness.ts";
import {
  HISTORY_EVIDENCE_MAPPING_POLICY,
  mapBalanceEvidenceRequirements,
  mapPortfolioEvidenceRequirements,
  type HistoryBalanceEvidenceRow,
  type HistoryPortfolioEvidenceRow,
} from "./history-evidence-requirements.ts";
import type { HistoryAccount } from "./history-balance.ts";

export { HISTORY_EVIDENCE_MAPPING_POLICY };
export type {
  HistoryBalanceEvidenceRow,
  HistoryPortfolioEvidenceRow,
} from "./history-evidence-requirements.ts";

export type HistoryEvidenceLane = "balance" | "portfolio";

export type HistoryEvidenceLaneSummary = Readonly<{
  lane: HistoryEvidenceLane;
  status: "ready" | "partial" | "unavailable";
  requiredDates: readonly string[];
  coverage: Readonly<{
    requiredCount: number;
    observedCount: number;
    displayableCount: number;
    observedCoveragePct: number | null;
    displayCoveragePct: number | null;
  }>;
  reconstructedRowCount: number;
  missingRequirementKeys: readonly string[];
  ambiguousRequirementKeys: readonly string[];
  invalidRequirementKeys: readonly string[];
  rows: readonly HistoricalEvidenceClassification[];
}>;

export function buildHistoryEvidenceMapping(input: {
  account: HistoryAccount;
  requiredDates: Readonly<{
    balance: readonly string[];
    portfolio: readonly string[];
  }>;
  balanceRows: readonly HistoryBalanceEvidenceRow[];
  portfolioRows: readonly HistoryPortfolioEvidenceRow[];
}) {
  const balanceRequiredDates = Array.isArray(input.requiredDates?.balance)
    ? [...input.requiredDates.balance]
    : [];
  const portfolioRequiredDates = Array.isArray(input.requiredDates?.portfolio)
    ? [...input.requiredDates.portfolio]
    : [];
  const balanceRequirements = mapBalanceEvidenceRequirements({
    account: input.account,
    requiredDates: balanceRequiredDates,
    rows: input.balanceRows,
  });
  const portfolioRequirements = mapPortfolioEvidenceRequirements({
    account: input.account,
    requiredDates: portfolioRequiredDates,
    rows: input.portfolioRows,
  });

  return Object.freeze({
    policy: HISTORY_EVIDENCE_MAPPING_POLICY,
    account: input.account,
    lanes: Object.freeze({
      balance: summarizeLane(
        "balance",
        balanceRequiredDates,
        balanceRequirements,
      ),
      portfolio: summarizeLane(
        "portfolio",
        portfolioRequiredDates,
        portfolioRequirements,
      ),
    }),
  });
}

function summarizeLane(
  lane: HistoryEvidenceLane,
  requiredDates: readonly string[],
  requirements: readonly HistoricalEvidenceRequirement[],
): HistoryEvidenceLaneSummary {
  const summary = summarizeHistoricalEvidenceForConsumer({
    requirements,
    consumer: HISTORY_EVIDENCE_MAPPING_POLICY.consumer,
  });
  const rows = summary.rows;

  return Object.freeze({
    lane,
    status: summary.status as HistoryEvidenceLaneSummary["status"],
    requiredDates: Object.freeze([...requiredDates]),
    coverage: Object.freeze({
      requiredCount: summary.coverage.requiredCount,
      observedCount: summary.coverage.canonicalCount,
      displayableCount: summary.coverage.eligibleCount,
      observedCoveragePct: summary.coverage.canonicalCoveragePct,
      displayCoveragePct: summary.coverage.consumerCoveragePct,
    }),
    reconstructedRowCount: summary.coverage.reconstructedCount,
    missingRequirementKeys: keysForKind(rows, "missing"),
    ambiguousRequirementKeys: keysForKind(rows, "ambiguous"),
    invalidRequirementKeys: keysForKind(rows, "invalid"),
    rows,
  });
}

function keysForKind(
  rows: readonly HistoricalEvidenceClassification[],
  evidenceKind: HistoricalEvidenceKind,
) {
  return Object.freeze(
    rows.flatMap((row) =>
      row.effectiveEvidenceKind === evidenceKind && row.key ? [row.key] : [],
    ),
  );
}
