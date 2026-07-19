import { isRiskDate } from "./portfolio-risk-calendar.ts";
import {
  accountsForPortfolioScope,
  isNamedPortfolioAccount,
  type NamedPortfolioAccount,
  type PortfolioAccountScope,
} from "./portfolio-account-scope.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "./investment-lab-special-holding-authority.ts";
import {
  buildManualValuationHistoryCoverage,
  type ManualValuationCurrentRow,
  type ManualValuationSnapshotRow,
} from "./manual-valuation-history.ts";

const LEGACY_SOURCE = "base44_import";
const CURRENT_SOURCE = "varda_manual_daily_snapshot";
const CURRENT_RULE_VERSION = "varda-manual-daily-snapshot-v1";

export const INVESTMENT_LAB_DATA_AVAILABILITY_POLICY = Object.freeze({
  version: "investment_lab_data_availability_v1",
  marketReturnObservationTarget: 90,
  minimumActualComparisonDates: 2,
  actualCalculationAuthority: "current_writer_single_segment_only",
  legacySnapshotUsage: "display_only",
  missingEvidenceHandling: "visible_gap_or_reviewed_repair_only",
  silentInterpolation: "forbidden",
  providerCalls: "none",
  databaseWrites: "none",
} as const);

export type InvestmentLabAvailabilitySnapshotRow = Readonly<{
  snapshotDate: string;
  account: string;
  source: string | null;
  ruleVersion: string | null;
}>;

export type InvestmentLabAvailabilityExcludedHolding = Readonly<{
  account: string;
  ticker: string | null;
  name: string;
  market: string;
  currency: string;
  assetType: string | null;
  reason: "missing_ticker" | "non_positive_holding" | "unsupported_currency";
}>;

export type InvestmentLabMarketHistoryAvailabilityInput = Readonly<{
  inputStatus:
    | "blocked"
    | "ready"
    | "partial"
    | "insufficient_coverage"
    | "insufficient_instruments";
  requestedReturnObservations: number;
  usableReturnObservations: number;
  returnCoveragePct: number;
  selectedHoldingCount: number;
  eligibleHoldingCount: number;
  includedInstrumentCount: number;
  excludedHoldings: readonly InvestmentLabAvailabilityExcludedHolding[];
  blockerCount: number;
  priceGapCount: number;
  fxGapCount: number;
}>;

export type InvestmentLabScenarioAvailabilityStatus =
  | "limited_input_ready"
  | "market_only_ready"
  | "research_only"
  | "blocked";

export type InvestmentLabScenarioAvailabilityReason =
  | "latest_trusted_segment_ready"
  | "current_writer_segment_too_short"
  | "market_history_incomplete"
  | "authoritative_actual_history_pending"
  | "fount_scope_adjustment_required"
  | "manual_valuation_history_required"
  | "special_holding_price_authority_required"
  | "scheduled_rebalance_contract_pending"
  | "point_in_time_policy_receipts_missing"
  | "walk_forward_cost_constraints_pending"
  | "multivariate_history_unavailable";

export type InvestmentLabScenarioAvailability = Readonly<{
  id:
    | "same_flow_baselines"
    | "fixed_quantity"
    | "scheduled_weights"
    | "historical_policy_weights"
    | "hindsight_research";
  status: InvestmentLabScenarioAvailabilityStatus;
  reasons: readonly InvestmentLabScenarioAvailabilityReason[];
}>;

export type InvestmentLabRepairItem = Readonly<{
  id: "actual_history" | "market_history" | "krx_gold" | "fount";
  status:
    | "not_needed"
    | "review_required"
    | "provider_backfill_candidate"
    | "manual_history_required"
    | "scope_transform_required";
  affectedCount: number;
}>;

export type InvestmentLabDataAvailability = ReturnType<
  typeof buildInvestmentLabDataAvailability
>;

export function applyInvestmentLabFountAvailabilityScope(
  model: InvestmentLabDataAvailability,
  scopeStatus: "not_applicable" | "applied" | "blocked",
): InvestmentLabDataAvailability {
  if (scopeStatus !== "applied") return model;

  const scenarioRows = model.scenarioRows.map((row) => {
    if (!row.reasons.includes("fount_scope_adjustment_required")) return row;
    const reasons = row.reasons.filter(
      (reason) => reason !== "fount_scope_adjustment_required",
    );
    return Object.freeze({
      ...row,
      status: statusAfterFountAdjustment(row.id, reasons),
      reasons: Object.freeze(reasons),
    });
  });
  const repairItems = model.repairItems.map((row) =>
    row.id === "fount"
      ? Object.freeze({ ...row, status: "not_needed" as const })
      : row,
  );

  return Object.freeze({
    ...model,
    status: scenarioRows.some((row) => row.status !== "blocked")
      ? ("partial" as const)
      : ("blocked" as const),
    scenarioRows: Object.freeze(scenarioRows),
    repairItems: Object.freeze(repairItems),
  });
}

export function buildInvestmentLabDataAvailability(input: {
  account: PortfolioAccountScope;
  snapshotRows: readonly InvestmentLabAvailabilitySnapshotRow[];
  marketHistory: InvestmentLabMarketHistoryAvailabilityInput;
  manualValuationCurrentRows?: readonly ManualValuationCurrentRow[];
  manualValuationSnapshotRows?: readonly ManualValuationSnapshotRow[];
}) {
  const actualHistory = buildActualHistory(input.snapshotRows, input.account);
  const goldDecision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
  const manualValuationHistory = buildManualValuationHistoryCoverage({
    account: input.account,
    target: {
      assetName: goldDecision.assetName,
      account: goldDecision.account,
      market: goldDecision.market,
      currency: goldDecision.currency,
      assetType: goldDecision.assetType,
    },
    currentRows: input.manualValuationCurrentRows ?? [],
    snapshotRows: input.manualValuationSnapshotRows ?? [],
    requiredSnapshotDates: actualHistory.latestCurrentWriterServiceDates,
  });
  const specialHoldings = classifySpecialHoldings(
    input.marketHistory.excludedHoldings,
  );
  const hasFount = specialHoldings.some((row) => row.kind === "fount");
  const hasGold = specialHoldings.some((row) => row.kind === "krx_gold");
  const hasUnresolvedSpecialHolding = specialHoldings.some(
    (row) => row.kind === "unresolved",
  );
  const marketHistoryReady =
    input.marketHistory.blockerCount === 0 &&
    input.marketHistory.eligibleHoldingCount > 0 &&
    input.marketHistory.usableReturnObservations >=
      input.marketHistory.requestedReturnObservations &&
    input.marketHistory.returnCoveragePct === 100;
  const multivariateHistoryReady =
    marketHistoryReady &&
    input.marketHistory.inputStatus === "ready" &&
    input.marketHistory.includedInstrumentCount >= 2;
  const actualSegmentReady =
    actualHistory.latestCurrentWriterDateCount >=
    INVESTMENT_LAB_DATA_AVAILABILITY_POLICY.minimumActualComparisonDates;
  const specialHistoryBlocked = hasGold || hasUnresolvedSpecialHolding;
  const specialHistoryReasons: InvestmentLabScenarioAvailabilityReason[] = [
    ...(hasGold ? (["manual_valuation_history_required"] as const) : []),
    ...(hasUnresolvedSpecialHolding
      ? (["special_holding_price_authority_required"] as const)
      : []),
  ];

  const scenarioRows: readonly InvestmentLabScenarioAvailability[] =
    Object.freeze([
      scenario(
        "same_flow_baselines",
        actualSegmentReady && !hasFount
          ? "limited_input_ready"
          : "blocked",
        [
          actualSegmentReady
            ? "latest_trusted_segment_ready"
            : "current_writer_segment_too_short",
          ...(hasFount ? ["fount_scope_adjustment_required" as const] : []),
        ],
      ),
      scenario(
        "fixed_quantity",
        marketHistoryReady && !hasFount && !specialHistoryBlocked
          ? "market_only_ready"
          : "blocked",
        [
          marketHistoryReady
            ? "authoritative_actual_history_pending"
            : "market_history_incomplete",
          ...(hasFount ? ["fount_scope_adjustment_required" as const] : []),
          ...specialHistoryReasons,
        ],
      ),
      scenario(
        "scheduled_weights",
        marketHistoryReady && !hasFount && !specialHistoryBlocked
          ? "market_only_ready"
          : "blocked",
        [
          marketHistoryReady
            ? "authoritative_actual_history_pending"
            : "market_history_incomplete",
          "scheduled_rebalance_contract_pending",
          ...(hasFount ? ["fount_scope_adjustment_required" as const] : []),
          ...specialHistoryReasons,
        ],
      ),
      scenario("historical_policy_weights", "blocked", [
        "point_in_time_policy_receipts_missing",
      ]),
      scenario(
        "hindsight_research",
        multivariateHistoryReady && !hasFount && !specialHistoryBlocked
          ? "research_only"
          : "blocked",
        [
          multivariateHistoryReady
            ? "walk_forward_cost_constraints_pending"
            : "multivariate_history_unavailable",
          ...(hasFount ? ["fount_scope_adjustment_required" as const] : []),
          ...specialHistoryReasons,
        ],
      ),
    ]);

  const repairItems: InvestmentLabRepairItem[] = [
    Object.freeze({
      id: "actual_history" as const,
      status:
        actualHistory.legacyDisplayDateCount > 0 || !actualSegmentReady
          ? ("review_required" as const)
          : ("not_needed" as const),
      affectedCount:
        actualHistory.legacyDisplayDateCount + actualHistory.invalidDateCount,
    }),
    Object.freeze({
      id: "market_history" as const,
      status:
        input.marketHistory.priceGapCount + input.marketHistory.fxGapCount > 0
          ? ("provider_backfill_candidate" as const)
          : ("not_needed" as const),
      affectedCount:
        input.marketHistory.priceGapCount + input.marketHistory.fxGapCount,
    }),
  ];
  if (hasGold) {
    repairItems.push(
      Object.freeze({
        id: "krx_gold" as const,
        status: "manual_history_required" as const,
        affectedCount: specialHoldings.filter((row) => row.kind === "krx_gold")
          .length,
      }),
    );
  }
  if (hasFount) {
    repairItems.push(
      Object.freeze({
        id: "fount" as const,
        status: "scope_transform_required" as const,
        affectedCount: specialHoldings.filter((row) => row.kind === "fount")
          .length,
      }),
    );
  }

  return Object.freeze({
    status: scenarioRows.some((row) => row.status !== "blocked")
      ? ("partial" as const)
      : ("blocked" as const),
    policy: INVESTMENT_LAB_DATA_AVAILABILITY_POLICY,
    account: input.account,
    actualHistory,
    manualValuationHistory,
    marketHistory: Object.freeze({
      status: marketHistoryReady
        ? ("ready" as const)
        : input.marketHistory.usableReturnObservations > 0
          ? ("partial" as const)
          : ("unavailable" as const),
      multivariateStatus: multivariateHistoryReady
        ? ("ready" as const)
        : ("unavailable" as const),
      ...input.marketHistory,
    }),
    specialHoldings,
    scenarioRows,
    repairItems: Object.freeze(repairItems),
  });
}

function buildActualHistory(
  rows: readonly InvestmentLabAvailabilitySnapshotRow[],
  accountScope: PortfolioAccountScope,
) {
  const selectedAccounts = accountsForPortfolioScope(accountScope);
  const rowsByDate = new Map<
    string,
    Map<NamedPortfolioAccount, InvestmentLabAvailabilitySnapshotRow[]>
  >();
  let invalidRowCount = 0;

  for (const row of rows) {
    const account = normalizeText(row.account).toLowerCase();
    if (!isNamedPortfolioAccount(account) || !selectedAccounts.includes(account)) {
      continue;
    }
    if (!isRiskDate(row.snapshotDate)) {
      invalidRowCount += 1;
      continue;
    }
    const accountRows = rowsByDate.get(row.snapshotDate) ?? new Map();
    const dateRows = accountRows.get(account) ?? [];
    dateRows.push(row);
    accountRows.set(account, dateRows);
    rowsByDate.set(row.snapshotDate, accountRows);
  }

  const dates = [...rowsByDate.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const completeDates: Array<{
    snapshotDate: string;
    role: "legacy" | "current" | "invalid";
  }> = [];
  let incompleteDateCount = 0;

  for (const [snapshotDate, accountRows] of dates) {
    const rowsForDate = selectedAccounts.flatMap(
      (account) => accountRows.get(account) ?? [],
    );
    if (
      rowsForDate.length !== selectedAccounts.length ||
      selectedAccounts.some((account) => accountRows.get(account)?.length !== 1)
    ) {
      incompleteDateCount += 1;
      continue;
    }
    completeDates.push({ snapshotDate, role: sourceRole(rowsForDate) });
  }

  const recognizedRoles = completeDates
    .map((row) => row.role)
    .filter((role): role is "legacy" | "current" => role !== "invalid");
  const sourceTransitionCount = recognizedRoles.reduce(
    (count, role, index) =>
      index > 0 && role !== recognizedRoles[index - 1] ? count + 1 : count,
    0,
  );
  const latestCurrentRows: typeof completeDates = [];
  for (let index = completeDates.length - 1; index >= 0; index -= 1) {
    const row = completeDates[index];
    if (row.role !== "current") break;
    latestCurrentRows.unshift(row);
  }
  const invalidCompleteDateCount = completeDates.filter(
    (row) => row.role === "invalid",
  ).length;

  return Object.freeze({
    status:
      latestCurrentRows.length >=
      INVESTMENT_LAB_DATA_AVAILABILITY_POLICY.minimumActualComparisonDates
        ? ("limited_current_segment" as const)
        : ("insufficient_current_segment" as const),
    observedDateCount: dates.length,
    completeDateCount: completeDates.length,
    legacyDisplayDateCount: completeDates.filter((row) => row.role === "legacy")
      .length,
    currentWriterDateCount: completeDates.filter(
      (row) => row.role === "current",
    ).length,
    latestCurrentWriterDateCount: latestCurrentRows.length,
    invalidDateCount:
      invalidRowCount + incompleteDateCount + invalidCompleteDateCount,
    sourceTransitionCount,
    availableStartServiceDate: completeDates[0]?.snapshotDate ?? null,
    availableEndServiceDate: completeDates.at(-1)?.snapshotDate ?? null,
    latestCurrentWriterStartServiceDate:
      latestCurrentRows[0]?.snapshotDate ?? null,
    latestCurrentWriterEndServiceDate:
      latestCurrentRows.at(-1)?.snapshotDate ?? null,
    latestCurrentWriterServiceDates: Object.freeze(
      latestCurrentRows.map((row) => row.snapshotDate),
    ),
  });
}

function statusAfterFountAdjustment(
  id: InvestmentLabScenarioAvailability["id"],
  reasons: readonly InvestmentLabScenarioAvailabilityReason[],
): InvestmentLabScenarioAvailabilityStatus {
  if (id === "same_flow_baselines") {
    return reasons.includes("latest_trusted_segment_ready")
      ? "limited_input_ready"
      : "blocked";
  }
  const specialHistoryBlocked =
    reasons.includes("manual_valuation_history_required") ||
    reasons.includes("special_holding_price_authority_required");
  if (id === "fixed_quantity" || id === "scheduled_weights") {
    return !specialHistoryBlocked &&
      reasons.includes("authoritative_actual_history_pending")
      ? "market_only_ready"
      : "blocked";
  }
  if (id === "hindsight_research") {
    return !specialHistoryBlocked &&
      reasons.includes("walk_forward_cost_constraints_pending")
      ? "research_only"
      : "blocked";
  }
  return "blocked";
}

function sourceRole(
  rows: readonly InvestmentLabAvailabilitySnapshotRow[],
): "legacy" | "current" | "invalid" {
  if (rows.every((row) => normalizeText(row.source) === LEGACY_SOURCE)) {
    return "legacy";
  }
  if (
    rows.every(
      (row) =>
        normalizeText(row.source) === CURRENT_SOURCE &&
        normalizeText(row.ruleVersion) === CURRENT_RULE_VERSION,
    )
  ) {
    return "current";
  }
  return "invalid";
}

function classifySpecialHoldings(
  rows: readonly InvestmentLabAvailabilityExcludedHolding[],
) {
  return Object.freeze(
    rows
      .filter((row) => row.reason === "missing_ticker")
      .map((row) => {
        const kind = matchesSpecialDecision(row, "fount")
          ? ("fount" as const)
          : matchesSpecialDecision(row, "krxGold")
            ? ("krx_gold" as const)
            : ("unresolved" as const);
        return Object.freeze({
          kind,
          account: normalizeText(row.account).toLowerCase(),
          name: normalizeText(row.name) || "이름 없는 보유자산",
        });
      })
      .sort((left, right) =>
        `${left.account}:${left.name}`.localeCompare(
          `${right.account}:${right.name}`,
        ),
      ),
  );
}

function matchesSpecialDecision(
  row: InvestmentLabAvailabilityExcludedHolding,
  key: "fount" | "krxGold",
) {
  const decision =
    DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions[key];
  return (
    normalizeText(row.name) === decision.assetName &&
    normalizeText(row.account).toLowerCase() === decision.account &&
    normalizeText(row.market).toLowerCase() === decision.market &&
    normalizeText(row.currency).toUpperCase() === decision.currency &&
    normalizeText(row.assetType).toLowerCase() === decision.assetType
  );
}

function scenario(
  id: InvestmentLabScenarioAvailability["id"],
  status: InvestmentLabScenarioAvailabilityStatus,
  reasons: readonly InvestmentLabScenarioAvailabilityReason[],
): InvestmentLabScenarioAvailability {
  return Object.freeze({
    id,
    status,
    reasons: Object.freeze([...new Set(reasons)]),
  });
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
