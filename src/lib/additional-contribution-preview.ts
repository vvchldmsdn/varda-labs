import {
  allocateAdditionalContribution,
  type AdditionalContributionBlockerReason,
} from "./additional-contribution-allocator.ts";
import type {
  AdditionalContributionMa120OperationalEvidence,
  AdditionalContributionMa120OperationalPriceBasis,
} from "./additional-contribution-ma120-operational-evidence.ts";
import {
  ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY,
  compareAdditionalContributionMa120Overlay,
  type AdditionalContributionMa120OverlayBlocker,
  type AdditionalContributionMa120OverlayDecision,
  type AdditionalContributionMa120OverlayMode,
} from "./additional-contribution-ma120-overlay.ts";
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
  allocationEffect: "bounded_overlay";
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

export function attachAdditionalContributionMa120Evidence<
  TPreview extends AdditionalContributionMa120AttachablePreview,
>({
  preview,
  ma120Read,
  mode = "off",
}: {
  preview: TPreview;
  ma120Read: AdditionalContributionMa120ReadPort;
  mode?: AdditionalContributionMa120OverlayMode;
}) {
  return applyAdditionalContributionMa120Overlay({ preview, ma120Read, mode });
}

type AdditionalContributionMa120AttachableRow = Readonly<{
  allocationKey?: string | null;
  market: string | null;
  currency: string | null;
  ticker: string | null;
  currentValueKrw: number;
  allocationKrw: number;
  postTopupValueKrw: number;
  postTopupWeightPct: number;
}>;

type AdditionalContributionMa120AttachablePreview = Readonly<{
  status: "ready";
  serviceDate: string;
  cashAmountKrw: number;
  postTopupTotalKrw: number;
  totalAllocatedKrw: number;
  residualCashKrw: number;
  rows: readonly AdditionalContributionMa120AttachableRow[];
}>;

type AdditionalContributionMa120AppliedRow<
  TRow extends AdditionalContributionMa120AttachableRow,
> = Readonly<
  Omit<
    TRow,
    "allocationKrw" | "postTopupValueKrw" | "postTopupWeightPct"
  > & {
    allocationKrw: number;
    strategicAllocationKrw: number;
    ma120Multiplier: number;
    ma120ReductionKrw: number;
    ma120Decision: AdditionalContributionMa120OverlayDecision | "overlay_blocked";
    postTopupValueKrw: number;
    postTopupWeightPct: number;
    ma120Evidence: ReturnType<typeof compactMa120Evidence>;
  }
>;

export type AdditionalContributionMa120AppliedPreview<
  TPreview extends AdditionalContributionMa120AttachablePreview,
> = Readonly<
  Omit<TPreview, "totalAllocatedKrw" | "residualCashKrw" | "rows"> & {
    totalAllocatedKrw: number;
    residualCashKrw: number;
    ma120Evidence: Readonly<{
      policyVersion: string;
      overlayPolicyVersion: typeof ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY.version;
      allocationEffect: "bounded_overlay" | "disabled";
      mode: AdditionalContributionMa120OverlayMode;
      overlayStatus: "blocked" | "ready" | "partial" | "disabled";
      totalReductionKrw: number;
      blockers: readonly AdditionalContributionMa120OverlayBlocker[];
      status: AdditionalContributionMa120ReadPort["status"];
      suppliedHoldingCount: number;
      evaluatedHoldingCount: number;
      usableCount: number;
      unavailableCount: number;
    }>;
    rows: readonly AdditionalContributionMa120AppliedRow<
      TPreview["rows"][number]
    >[];
  }
>;

export function applyAdditionalContributionMa120Overlay<
  TPreview extends AdditionalContributionMa120AttachablePreview,
>({
  preview,
  ma120Read,
  mode,
}: {
  preview: TPreview;
  ma120Read: AdditionalContributionMa120ReadPort;
  mode: AdditionalContributionMa120OverlayMode;
}): AdditionalContributionMa120AppliedPreview<TPreview> {
  const overlay = compareAdditionalContributionMa120Overlay({
    mode,
    serviceDate: preview.serviceDate,
    baseline: {
      cashAmountKrw: preview.cashAmountKrw,
      totalAllocatedKrw: preview.totalAllocatedKrw,
      residualCashKrw: preview.residualCashKrw,
      allocations: preview.rows.map((row, index) => ({
        allocationKey: allocationKey(row, index),
        market: row.market,
        currency: row.currency,
        ticker: row.ticker,
        allocationKrw: row.allocationKrw,
      })),
    },
    evidence: ma120Read.rows.map((row) => ({
      instrumentKey: row.instrumentKey,
      status: row.status,
      latestWindowPriceDate:
        row.evidence?.latestWindowPriceDate ?? null,
      distanceFromMaPct: row.evidence?.distanceFromMaPct ?? null,
    })),
  });

  const evidenceByInstrument = new Map(
    ma120Read.rows.map((row) => [row.instrumentKey, row] as const),
  );
  const overlayByAllocationKey = new Map(
    overlay.rows.map((row) => [row.allocationKey, row] as const),
  );
  const overlayApplied = overlay.status !== "blocked";
  const totalAllocatedKrw = overlayApplied
    ? overlay.overlayAllocatedKrw
    : preview.totalAllocatedKrw;
  const residualCashKrw = overlayApplied
    ? overlay.overlayResidualCashKrw
    : preview.residualCashKrw;

  return Object.freeze({
    ...preview,
    totalAllocatedKrw,
    residualCashKrw,
    ma120Evidence: Object.freeze({
      policyVersion: ma120Read.policyVersion,
      overlayPolicyVersion:
        ADDITIONAL_CONTRIBUTION_MA120_OVERLAY_POLICY.version,
      allocationEffect:
        mode === "enabled" ? ma120Read.allocationEffect : "disabled",
      mode,
      overlayStatus: overlay.status,
      totalReductionKrw: overlayApplied ? overlay.totalReductionKrw : 0,
      blockers: overlay.blockers,
      status: ma120Read.status,
      suppliedHoldingCount: ma120Read.suppliedHoldingCount,
      evaluatedHoldingCount: ma120Read.evaluatedHoldingCount,
      usableCount: ma120Read.usableCount,
      unavailableCount: ma120Read.unavailableCount,
    }),
    rows: Object.freeze(
      preview.rows.map((row, index) => {
        const evidence = evidenceByInstrument.get(instrumentKey(row) ?? "");
        const overlayRow = overlayByAllocationKey.get(allocationKey(row, index));
        const allocationKrw = overlayRow?.overlayAllocationKrw ?? row.allocationKrw;
        return Object.freeze({
          ...row,
          allocationKrw,
          strategicAllocationKrw: row.allocationKrw,
          ma120Multiplier: overlayRow?.multiplier ?? 1,
          ma120ReductionKrw: overlayRow?.reductionKrw ?? 0,
          ma120Decision: overlayRow?.decision ?? "overlay_blocked",
          postTopupValueKrw: row.currentValueKrw + allocationKrw,
          postTopupWeightPct:
            preview.postTopupTotalKrw > 0
              ? ((row.currentValueKrw + allocationKrw) /
                  preview.postTopupTotalKrw) *
                100
              : 0,
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
  }) as AdditionalContributionMa120AppliedPreview<TPreview>;
}

export function additionalContributionMa120ReadFailure(
  suppliedHoldingCount: number,
): AdditionalContributionMa120ReadPort {
  return Object.freeze({
    policyVersion: "additional_contribution_ma120_operational_evidence_v1",
    allocationEffect: "bounded_overlay",
    status: "read_failed",
    suppliedHoldingCount,
    evaluatedHoldingCount: 0,
    usableCount: 0,
    unavailableCount: suppliedHoldingCount,
    rows: Object.freeze([]),
  });
}

function allocationKey(
  row: AdditionalContributionMa120AttachableRow,
  index: number,
) {
  const explicit = normalize(row.allocationKey ?? null, "lower");
  return explicit ?? instrumentKey(row) ?? `invalid:${index}`;
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
