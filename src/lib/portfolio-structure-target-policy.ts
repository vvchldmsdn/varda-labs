import type {
  PortfolioStructureHoldingRow,
  PortfolioStructureResult,
} from "./portfolio-structure.ts";

export type PortfolioStructureEffectiveTargetInput = Readonly<{
  account: string;
  market: string;
  currency: string;
  ticker: string | null;
  targetWeightBps: number;
}>;

export type PortfolioStructureTargetProjectionStatus =
  | "applied"
  | "partial"
  | "unavailable"
  | "invalid";

export type PortfolioStructureTargetProjection = Readonly<{
  status: PortfolioStructureTargetProjectionStatus;
  reason: string;
  structure: PortfolioStructureResult;
  coverage: Readonly<{
    policyTargetCount: number;
    matchedHoldingCount: number;
    unmatchedHoldingCount: number;
    unmatchedTargetCount: number;
    totalTargetWeightBps: number;
  }>;
}>;

export function projectPortfolioStructureEffectiveTargets({
  policyStatus,
  structure,
  targets,
}: {
  policyStatus: string;
  structure: PortfolioStructureResult;
  targets: readonly PortfolioStructureEffectiveTargetInput[];
}): PortfolioStructureTargetProjection {
  if (policyStatus !== "available") {
    if (
      policyStatus === "conflict" ||
      policyStatus === "universe_mismatch" ||
      policyStatus === "integrity_error"
    ) {
      return invalidProjection(structure, policyStatus);
    }
    return unavailableProjection(structure, policyStatus);
  }

  const targetByIdentity = new Map<string, number>();
  let totalTargetWeightBps = 0;
  for (const target of targets) {
    if (
      !Number.isSafeInteger(target.targetWeightBps) ||
      target.targetWeightBps < 0 ||
      target.targetWeightBps > 10_000
    ) {
      return invalidProjection(structure, "invalid_target_weight");
    }
    const key = portfolioStructureHoldingIdentityKey(target);
    if (targetByIdentity.has(key)) {
      return invalidProjection(structure, "duplicate_target_identity");
    }
    targetByIdentity.set(key, target.targetWeightBps);
    totalTargetWeightBps += target.targetWeightBps;
  }
  if (targets.length === 0 || totalTargetWeightBps !== 10_000) {
    return invalidProjection(structure, "invalid_target_total");
  }

  const holdingIdentities = new Set<string>();
  for (const holding of structure.holdingRows) {
    const key = portfolioStructureHoldingIdentityKey(holding);
    if (holdingIdentities.has(key)) {
      return invalidProjection(structure, "duplicate_holding_identity");
    }
    holdingIdentities.add(key);
  }

  const matchedTargetIdentities = new Set<string>();
  const holdingRows = structure.holdingRows.map((holding) => {
    const key = portfolioStructureHoldingIdentityKey(holding);
    const targetWeightBps = targetByIdentity.get(key);
    if (targetWeightBps === undefined) return holding;

    matchedTargetIdentities.add(key);
    const effectiveTargetPct = targetWeightBps / 100;
    return {
      ...holding,
      effectiveTargetPct,
      driftPct: holding.currentWeightPct - effectiveTargetPct,
      targetPolicyStatus: "approved_policy" as const,
    };
  });
  const matchedHoldingCount = matchedTargetIdentities.size;
  const unmatchedHoldingCount = holdingRows.length - matchedHoldingCount;
  const unmatchedTargetCount =
    targetByIdentity.size - matchedTargetIdentities.size;
  const status =
    unmatchedHoldingCount === 0 && unmatchedTargetCount === 0
      ? ("applied" as const)
      : ("partial" as const);
  const groupRows = structure.groupRows.map((group) => {
    if (status !== "applied") return group;
    const effectiveTargetPct = holdingRows
      .filter((holding) => holding.groupName === group.name)
      .reduce(
        (sum, holding) => sum + (holding.effectiveTargetPct ?? 0),
        0,
      );
    return {
      ...group,
      effectiveTargetPct,
      driftPct: group.currentWeightPct - effectiveTargetPct,
    };
  });

  return Object.freeze({
    status,
    reason: status === "applied" ? "exact_policy_identity_match" : "partial_policy_identity_match",
    structure: {
      ...structure,
      holdingRows,
      groupRows,
      dataHealth: {
        ...structure.dataHealth,
        unresolvedTargetPolicyCount: unmatchedHoldingCount,
      },
    },
    coverage: Object.freeze({
      policyTargetCount: targets.length,
      matchedHoldingCount,
      unmatchedHoldingCount,
      unmatchedTargetCount,
      totalTargetWeightBps,
    }),
  });
}

export function portfolioStructureHoldingIdentityKey(row: {
  account?: string;
  accountCode?: string;
  market: string;
  currency: string;
  ticker: string | null;
}) {
  return [
    (row.account ?? row.accountCode ?? "").trim().toLowerCase(),
    row.market.trim().toLowerCase(),
    row.currency.trim().toUpperCase(),
    row.ticker?.trim().toUpperCase() ?? "",
  ].join(":");
}

function unavailableProjection(
  structure: PortfolioStructureResult,
  reason: string,
): PortfolioStructureTargetProjection {
  return Object.freeze({
    status: "unavailable" as const,
    reason,
    structure,
    coverage: emptyCoverage(structure.holdingRows),
  });
}

function invalidProjection(
  structure: PortfolioStructureResult,
  reason: string,
): PortfolioStructureTargetProjection {
  return Object.freeze({
    status: "invalid" as const,
    reason,
    structure,
    coverage: emptyCoverage(structure.holdingRows),
  });
}

function emptyCoverage(holdingRows: readonly PortfolioStructureHoldingRow[]) {
  return Object.freeze({
    policyTargetCount: 0,
    matchedHoldingCount: 0,
    unmatchedHoldingCount: holdingRows.length,
    unmatchedTargetCount: 0,
    totalTargetWeightBps: 0,
  });
}
