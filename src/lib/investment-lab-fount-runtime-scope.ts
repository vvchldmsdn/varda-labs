import {
  buildInvestmentLabFountScopeAdjustment,
  type InvestmentLabFountPositionRow,
  type InvestmentLabFountStaticBinding,
} from "./investment-lab-fount-exclusion.ts";
import type {
  InvestmentLabCounterfactualReadInput,
  InvestmentLabSourceEventRow,
  InvestmentLabSourceSnapshotRow,
} from "./investment-lab-counterfactual-read-model.ts";
import type { PortfolioAccountScope } from "./portfolio-account-scope.ts";

export const INVESTMENT_LAB_FOUNT_RUNTIME_SCOPE_POLICY = Object.freeze({
  version: "investment_lab_fount_runtime_scope_v1",
  applicableScopes: Object.freeze(["irp", "all"] as const),
  bindingAuthority: "reviewed_metadata_then_exact_legacy_identity",
  output: "scope_adjusted_observed_path_only",
  rawIdentityExposure: "forbidden",
} as const);

export type InvestmentLabFountRuntimeEvidence =
  | Readonly<{ status: "not_applicable" }>
  | Readonly<{
      status: "unavailable";
      reason:
        | "binding_ambiguous"
        | "binding_invalid"
        | "binding_metadata_conflict"
        | "position_value_missing";
    }>
  | Readonly<{
      status: "ready";
      binding: InvestmentLabFountStaticBinding;
      positionRows: readonly InvestmentLabFountPositionRow[];
    }>;

export type InvestmentLabFountRuntimeScope = Readonly<{
  status: "not_applicable" | "applied" | "blocked";
  policy: typeof INVESTMENT_LAB_FOUNT_RUNTIME_SCOPE_POLICY;
  adjustedDateCount: number;
  excludedAccount: "irp" | null;
}>;

export type InvestmentLabFountObservedRuntimeScope = Readonly<{
  status: "not_applicable" | "applied" | "partial" | "blocked";
  policy: typeof INVESTMENT_LAB_FOUNT_RUNTIME_SCOPE_POLICY;
  adjustedDateCount: number;
  blockedServiceDates: readonly string[];
  excludedAccount: "irp" | null;
}>;

export function applyInvestmentLabFountRuntimeScope(input: Readonly<{
  account: PortfolioAccountScope;
  serviceDates: readonly string[];
  source: InvestmentLabCounterfactualReadInput;
  allEventRows: readonly InvestmentLabSourceEventRow[];
  evidence: InvestmentLabFountRuntimeEvidence;
}>): Readonly<{
  source: InvestmentLabCounterfactualReadInput;
  scope: InvestmentLabFountRuntimeScope;
}> {
  if (input.account !== "irp" && input.account !== "all") {
    return result(input.source, "not_applicable", 0, null);
  }
  if (input.evidence.status === "not_applicable") {
    return result(input.source, "not_applicable", 0, null);
  }
  if (input.evidence.status !== "ready") {
    return result(input.source, "blocked", 0, "irp");
  }

  const adjustment = buildInvestmentLabFountScopeAdjustment({
    staticBinding: input.evidence.binding,
    serviceDates: input.serviceDates,
    portfolioRows: input.source.snapshotRows.map((row) => ({
      snapshotDate: row.snapshotDate,
      account: row.account,
      source: row.source ?? "",
      totalMarketValueKrw: row.totalMarketValue ?? "",
    })),
    positionRows: input.evidence.positionRows,
    eventRows: input.allEventRows.map((row) => ({
      eventDate: row.eventDate,
      legacyAssetId: row.legacyAssetId ?? null,
    })),
  });
  if (adjustment.status !== "ready") {
    return result(input.source, "blocked", 0, "irp");
  }

  const adjustedByAccountDate = new Map(
    adjustment.accountRows.map((row) => [
      `${row.serviceDate}:${row.account}`,
      row.adjustedTotalMarketValueKrw,
    ]),
  );
  const snapshotRows = input.source.snapshotRows
    .filter((row) => row.account !== "all")
    .map((row) => {
      const adjustedValue = adjustedByAccountDate.get(
        `${row.snapshotDate}:${row.account}`,
      );
      return adjustedValue === undefined
        ? row
        : Object.freeze({ ...row, totalMarketValue: adjustedValue });
    });

  return result(
    Object.freeze({ ...input.source, snapshotRows: Object.freeze(snapshotRows) }),
    "applied",
    adjustment.coverage.adjustedDateCount,
    "irp",
  );
}

export function applyInvestmentLabFountObservedRuntimeScope(input: Readonly<{
  account: PortfolioAccountScope;
  serviceDates: readonly string[];
  source: InvestmentLabCounterfactualReadInput;
  allEventRows: readonly InvestmentLabSourceEventRow[];
  evidence: InvestmentLabFountRuntimeEvidence;
}>): Readonly<{
  source: InvestmentLabCounterfactualReadInput;
  scope: InvestmentLabFountObservedRuntimeScope;
}> {
  if (input.account !== "irp" && input.account !== "all") {
    return observedResult(input.source, "not_applicable", 0, [], null);
  }
  if (input.evidence.status === "not_applicable") {
    return observedResult(input.source, "not_applicable", 0, [], null);
  }

  const completeDateSet = new Set(input.serviceDates);
  const sourceRowsByDate = groupBySnapshotDate(input.source.snapshotRows);
  const observedDates = Object.freeze([...sourceRowsByDate.keys()].sort());
  if (input.evidence.status !== "ready") {
    return observedResult(
      input.source,
      "blocked",
      0,
      observedDates,
      "irp",
    );
  }

  const positionRowsByDate = groupBySnapshotDate(input.evidence.positionRows);
  const snapshotRows: InvestmentLabSourceSnapshotRow[] = [];
  const blockedServiceDates: string[] = [];
  let adjustedDateCount = 0;
  for (const serviceDate of observedDates) {
    const sourceRows = sourceRowsByDate.get(serviceDate) ?? [];
    if (!completeDateSet.has(serviceDate)) {
      blockedServiceDates.push(serviceDate);
      snapshotRows.push(...sourceRows);
      continue;
    }

    const dateSource = Object.freeze({
      ...input.source,
      snapshotRows: Object.freeze(sourceRows),
    });
    const dateAdjustment = applyInvestmentLabFountRuntimeScope({
      ...input,
      serviceDates: Object.freeze([serviceDate]),
      source: dateSource,
      evidence: Object.freeze({
        ...input.evidence,
        positionRows: Object.freeze(
          positionRowsByDate.get(serviceDate) ?? [],
        ),
      }),
    });
    if (dateAdjustment.scope.status !== "applied") {
      blockedServiceDates.push(serviceDate);
      snapshotRows.push(...sourceRows);
      continue;
    }
    adjustedDateCount += 1;
    snapshotRows.push(...dateAdjustment.source.snapshotRows);
  }

  const status =
    adjustedDateCount === 0
      ? "blocked"
      : blockedServiceDates.length > 0
        ? "partial"
        : "applied";
  return observedResult(
    Object.freeze({
      ...input.source,
      snapshotRows: Object.freeze(snapshotRows),
    }),
    status,
    adjustedDateCount,
    blockedServiceDates,
    "irp",
  );
}

function result(
  source: InvestmentLabCounterfactualReadInput,
  status: InvestmentLabFountRuntimeScope["status"],
  adjustedDateCount: number,
  excludedAccount: InvestmentLabFountRuntimeScope["excludedAccount"],
) {
  return Object.freeze({
    source,
    scope: Object.freeze({
      status,
      policy: INVESTMENT_LAB_FOUNT_RUNTIME_SCOPE_POLICY,
      adjustedDateCount,
      excludedAccount,
    }),
  });
}

function observedResult(
  source: InvestmentLabCounterfactualReadInput,
  status: InvestmentLabFountObservedRuntimeScope["status"],
  adjustedDateCount: number,
  blockedServiceDates: readonly string[],
  excludedAccount: InvestmentLabFountObservedRuntimeScope["excludedAccount"],
) {
  return Object.freeze({
    source,
    scope: Object.freeze({
      status,
      policy: INVESTMENT_LAB_FOUNT_RUNTIME_SCOPE_POLICY,
      adjustedDateCount,
      blockedServiceDates: Object.freeze([...blockedServiceDates]),
      excludedAccount,
    }),
  });
}

function groupBySnapshotDate<T extends Readonly<{ snapshotDate: string }>>(
  rows: readonly T[],
) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const matchingRows = grouped.get(row.snapshotDate) ?? [];
    matchingRows.push(row);
    grouped.set(row.snapshotDate, matchingRows);
  }
  return grouped;
}
