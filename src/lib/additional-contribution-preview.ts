import {
  allocateAdditionalContribution,
  type AdditionalContributionBlockerReason,
} from "./additional-contribution-allocator.ts";
import type {
  AdditionalContributionMa120OperationalEvidence,
  AdditionalContributionMa120OperationalPriceBasis,
} from "./additional-contribution-ma120-operational-evidence.ts";
import {
  normalizeTargetPolicyUniverseAccount,
  type TargetPolicyUniverseSourceRow,
} from "./target-policy-holding-universe.ts";
import {
  resolveApprovedTargetPolicy,
  type ApprovedTargetPolicyPort,
  type TargetPolicyResolverBlocker,
} from "./target-policy-resolver.ts";
import type { PortfolioStructureResult } from "./portfolio-structure.ts";

export type AdditionalContributionPreviewBlocker =
  | "target_policy_missing"
  | "target_policy_conflict"
  | "valuation_account_mismatch"
  | "valuation_identity_missing"
  | "valuation_identity_duplicate"
  | TargetPolicyResolverBlocker
  | AdditionalContributionBlockerReason;

export type AdditionalContributionApprovedPolicyPort = Readonly<{
  status: "available" | "missing" | "conflict";
  policy: ApprovedTargetPolicyPort | null;
}>;

export type AdditionalContributionMa120ReadPort = Readonly<{
  policyVersion: string;
  allocationEffect: "none";
  status: "ready" | "partial" | "unavailable" | "read_failed";
  suppliedHoldingCount: number;
  evaluatedHoldingCount: number;
  usableCount: number;
  unavailableCount: number;
  rows: readonly Readonly<{
    instrumentKey: string;
    status:
      | AdditionalContributionMa120OperationalEvidence["status"]
      | "unavailable";
    priceBasis: AdditionalContributionMa120OperationalPriceBasis | null;
    evidence: AdditionalContributionMa120OperationalEvidence | null;
    unavailableReason: string | null;
  }>[];
}>;

export function buildAdditionalContributionPreview({
  account: accountInput,
  cashAmountKrw,
  serviceDate,
  approvedPolicyRead,
  currentUniverse,
  structure,
}: {
  account: string;
  cashAmountKrw: number;
  serviceDate: string;
  approvedPolicyRead: AdditionalContributionApprovedPolicyPort;
  currentUniverse: Readonly<{
    account: string | null;
    rows: readonly TargetPolicyUniverseSourceRow[];
  }>;
  structure: PortfolioStructureResult;
}) {
  const account = normalizeTargetPolicyUniverseAccount(accountInput);
  if (!account) return blocked(null, null, ["invalid_account"]);

  if (
    approvedPolicyRead.status !== "available" ||
    approvedPolicyRead.policy === null
  ) {
    return blocked(account, null, [
      approvedPolicyRead.status === "conflict"
        ? "target_policy_conflict"
        : "target_policy_missing",
    ]);
  }

  const approvedPolicy = approvedPolicyRead.policy;
  const resolution = resolveApprovedTargetPolicy({
    request: {
      account,
      policyVersion: approvedPolicy.policyVersion,
      serviceDate,
    },
    approvedPolicy,
    currentUniverse: {
      account: currentUniverse.account ?? account,
      holdings: currentUniverse.rows,
    },
  });
  if (resolution.status !== "ready" || resolution.targetVector === null) {
    return blocked(account, approvedPolicy.policyVersion, resolution.blockers);
  }

  if (structure.selectedAccount !== account) {
    return blocked(account, approvedPolicy.policyVersion, [
      "valuation_account_mismatch",
    ]);
  }

  const namesByKey = new Map<string, string>();
  for (const row of currentUniverse.rows) {
    const key = instrumentKey(row);
    if (key && row.name) namesByKey.set(key, row.name);
  }

  const valuesByKey = new Map<string, number>();
  const duplicateValueKeys = new Set<string>();
  for (const row of structure.holdingRows) {
    const key = instrumentKey(row);
    if (!key) continue;
    if (valuesByKey.has(key)) duplicateValueKeys.add(key);
    valuesByKey.set(key, row.currentValueKrw);
  }
  if (duplicateValueKeys.size > 0) {
    return blocked(account, approvedPolicy.policyVersion, [
      "valuation_identity_duplicate",
    ]);
  }

  const holdings = resolution.targetVector.map((target) => ({
    market: target.market,
    currency: target.currency,
    ticker: target.ticker,
    currentValueKrw: valuesByKey.get(target.instrumentKey) ?? Number.NaN,
    targetWeightBps: target.targetWeightBps,
    buyability: target.buyability,
  }));
  if (holdings.some((row) => !Number.isFinite(row.currentValueKrw))) {
    return blocked(account, approvedPolicy.policyVersion, [
      "valuation_identity_missing",
    ]);
  }

  const allocation = allocateAdditionalContribution({
    account,
    targetPolicyVersion: approvedPolicy.policyVersion,
    cashAmountKrw,
    holdings,
  });
  if (allocation.status !== "ready") {
    return blocked(
      account,
      approvedPolicy.policyVersion,
      allocation.blockers.map((row) => row.reason),
    );
  }

  return Object.freeze({
    status: "ready",
    account,
    serviceDate,
    policyVersion: approvedPolicy.policyVersion,
    effectiveServiceDate: resolution.effectiveServiceDate,
    cashAmountKrw: allocation.cashAmountKrw,
    currentPortfolioTotalKrw: allocation.currentPortfolioTotalKrw,
    postTopupTotalKrw: allocation.postTopupTotalKrw,
    totalAllocatedKrw: allocation.totalAllocatedKrw,
    residualCashKrw: allocation.residualCashKrw,
    rows: Object.freeze(
      allocation.allocations.map((row) =>
        Object.freeze({
          name: namesByKey.get(row.instrumentKey ?? "") ?? row.ticker ?? "-",
          market: row.market,
          currency: row.currency,
          ticker: row.ticker,
          currentValueKrw: row.currentValueKrw,
          currentWeightPct:
            allocation.currentPortfolioTotalKrw > 0
              ? (row.currentValueKrw /
                  allocation.currentPortfolioTotalKrw) *
                100
              : 0,
          targetWeightPct: row.targetWeightBps / 100,
          allocationKrw: row.allocationKrw,
          postTopupValueKrw: row.currentValueKrw + row.allocationKrw,
          postTopupWeightPct:
            allocation.postTopupTotalKrw > 0
              ? ((row.currentValueKrw + row.allocationKrw) /
                  allocation.postTopupTotalKrw) *
                100
              : 0,
          allocationStatus: row.allocationStatus,
        }),
      ),
    ),
    blockers: Object.freeze([] as AdditionalContributionPreviewBlocker[]),
  } as const);
}

export function attachAdditionalContributionMa120Evidence({
  preview,
  ma120Read,
}: {
  preview: ReturnType<typeof buildAdditionalContributionPreview>;
  ma120Read: AdditionalContributionMa120ReadPort;
}) {
  if (preview.status !== "ready") return preview;

  const evidenceByInstrument = new Map(
    ma120Read.rows.map((row) => [row.instrumentKey, row] as const),
  );
  return Object.freeze({
    ...preview,
    ma120Evidence: Object.freeze({
      policyVersion: ma120Read.policyVersion,
      allocationEffect: ma120Read.allocationEffect,
      status: ma120Read.status,
      suppliedHoldingCount: ma120Read.suppliedHoldingCount,
      evaluatedHoldingCount: ma120Read.evaluatedHoldingCount,
      usableCount: ma120Read.usableCount,
      unavailableCount: ma120Read.unavailableCount,
    }),
    rows: Object.freeze(
      preview.rows.map((row) => {
        const evidence = evidenceByInstrument.get(instrumentKey(row) ?? "");
        return Object.freeze({
          ...row,
          ma120Evidence: evidence
            ? compactMa120Evidence(evidence)
            : Object.freeze({
                status: "unavailable" as const,
                priceBasis: null,
                availableObservationCount: 0,
                latestWindowPriceDate: null,
                ma120: null,
                distanceFromMaPct: null,
                unavailableReason: "evidence_row_missing",
              }),
        });
      }),
    ),
  });
}

export function additionalContributionMa120ReadFailure(
  suppliedHoldingCount: number,
): AdditionalContributionMa120ReadPort {
  return Object.freeze({
    policyVersion: "additional_contribution_ma120_operational_evidence_v1",
    allocationEffect: "none",
    status: "read_failed",
    suppliedHoldingCount,
    evaluatedHoldingCount: 0,
    usableCount: 0,
    unavailableCount: suppliedHoldingCount,
    rows: Object.freeze([]),
  });
}

function blocked(
  account: ReturnType<typeof normalizeTargetPolicyUniverseAccount>,
  policyVersion: string | null,
  blockers: readonly AdditionalContributionPreviewBlocker[],
) {
  return Object.freeze({
    status: "blocked",
    account,
    serviceDate: null,
    policyVersion,
    effectiveServiceDate: null,
    cashAmountKrw: null,
    currentPortfolioTotalKrw: null,
    postTopupTotalKrw: null,
    totalAllocatedKrw: null,
    residualCashKrw: null,
    rows: Object.freeze([]),
    blockers: Object.freeze([...new Set(blockers)].sort()),
  } as const);
}

function compactMa120Evidence(
  row: AdditionalContributionMa120ReadPort["rows"][number],
) {
  return Object.freeze({
    status: row.status,
    priceBasis: row.priceBasis,
    availableObservationCount:
      row.evidence?.availableObservationCount ?? 0,
    latestWindowPriceDate: row.evidence?.latestWindowPriceDate ?? null,
    ma120: row.evidence?.ma120 ?? null,
    distanceFromMaPct: row.evidence?.distanceFromMaPct ?? null,
    unavailableReason: row.unavailableReason,
  });
}

function instrumentKey(row: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}) {
  const market = normalize(row.market, "lower");
  const currency = normalize(row.currency, "upper");
  const ticker = normalize(row.ticker, "upper");
  return market && currency && ticker
    ? `${market}:${currency}:${ticker}`
    : null;
}

function normalize(value: string | null, casing: "lower" | "upper") {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return casing === "lower"
    ? normalized.toLowerCase()
    : normalized.toUpperCase();
}
