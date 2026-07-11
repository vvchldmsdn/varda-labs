import {
  TARGET_POLICY_HOLDING_UNIVERSE_POLICY,
  buildTargetPolicyHoldingUniverse,
  normalizeTargetPolicyUniverseAccount,
  type TargetPolicyUniverseSourceRow,
} from "./target-policy-holding-universe.ts";
import {
  TARGET_POLICY_REVIEW_PACKET_POLICY,
  buildTargetPolicyReviewPacket,
} from "./target-policy-review-packet.ts";
import type { TargetPolicyReviewVectorRow } from "./target-policy-review-serialization.ts";

export const TARGET_POLICY_RESOLVER_POLICY = Object.freeze({
  version: "target_policy_resolver_phase1a_v1",
  policyId: TARGET_POLICY_REVIEW_PACKET_POLICY.policyId,
  universePolicyVersion: TARGET_POLICY_HOLDING_UNIVERSE_POLICY.version,
  approvalAuthenticity: "trusted_adapter_required_outside_phase1a",
  approvalArtifactUse: "audit_evidence_only",
  rawTargetInference: "forbidden",
  persistence: "forbidden",
  allocatorConnection: "forbidden",
  productRouteUse: "forbidden",
} as const);

export type ApprovedTargetPolicyPort = Readonly<{
  approvalState: string;
  policyId: string;
  account: string;
  policyVersion: string;
  effectiveServiceDate: string;
  universeHash: string;
  vectorHash: string;
  vector: readonly TargetPolicyReviewVectorRow[];
}>;

export type TargetPolicyResolverRequest = Readonly<{
  account: string;
  policyVersion: string;
  serviceDate: string;
}>;

export type TargetPolicyResolverUniversePort = Readonly<{
  account: string;
  holdings: readonly TargetPolicyUniverseSourceRow[];
}>;

export type TargetPolicyResolverBlocker =
  | "target_policy_approval_missing"
  | "target_policy_policy_id_mismatch"
  | "target_policy_account_invalid"
  | "target_policy_version_unavailable"
  | "target_policy_effective_date_invalid"
  | "target_policy_service_date_invalid"
  | "target_policy_not_effective"
  | "target_policy_universe_mismatch"
  | "target_policy_vector_mismatch"
  | "target_policy_total_invalid"
  | "target_policy_instrument_unbuyable";

export type ResolvedTargetPolicyVectorRow = Readonly<{
  instrumentKey: string;
  market: string;
  currency: string;
  ticker: string;
  targetWeightBps: number;
  buyability: "buyable";
}>;

export function resolveApprovedTargetPolicy({
  request,
  approvedPolicy,
  currentUniverse,
}: {
  request: TargetPolicyResolverRequest;
  approvedPolicy: ApprovedTargetPolicyPort;
  currentUniverse: TargetPolicyResolverUniversePort;
}) {
  const blockers = new Set<TargetPolicyResolverBlocker>();
  const requestAccount = normalizeTargetPolicyUniverseAccount(request.account);
  const approvalAccount = normalizeTargetPolicyUniverseAccount(
    approvedPolicy.account,
  );
  const universeAccount = normalizeTargetPolicyUniverseAccount(
    currentUniverse.account,
  );
  const requestPolicyVersion = normalizePolicyVersion(request.policyVersion);
  const approvalPolicyVersion = normalizePolicyVersion(
    approvedPolicy.policyVersion,
  );
  const serviceDate = normalizeServiceDate(request.serviceDate);
  const effectiveServiceDate = normalizeServiceDate(
    approvedPolicy.effectiveServiceDate,
  );

  if (normalizeText(approvedPolicy.approvalState)?.toLowerCase() !== "approved") {
    blockers.add("target_policy_approval_missing");
  }
  if (approvedPolicy.policyId !== TARGET_POLICY_RESOLVER_POLICY.policyId) {
    blockers.add("target_policy_policy_id_mismatch");
  }
  if (
    !requestAccount ||
    !approvalAccount ||
    requestAccount !== approvalAccount
  ) {
    blockers.add("target_policy_account_invalid");
  }
  if (!universeAccount || universeAccount !== approvalAccount) {
    blockers.add("target_policy_universe_mismatch");
  }
  if (
    !requestPolicyVersion ||
    !approvalPolicyVersion ||
    requestPolicyVersion !== approvalPolicyVersion
  ) {
    blockers.add("target_policy_version_unavailable");
  }
  if (!effectiveServiceDate) {
    blockers.add("target_policy_effective_date_invalid");
  }
  if (!serviceDate) {
    blockers.add("target_policy_service_date_invalid");
  } else if (
    effectiveServiceDate &&
    serviceDate.localeCompare(effectiveServiceDate) < 0
  ) {
    blockers.add("target_policy_not_effective");
  }

  const universe = buildTargetPolicyHoldingUniverse({
    account: currentUniverse.account,
    holdings: Array.isArray(currentUniverse.holdings)
      ? currentUniverse.holdings
      : [],
  });
  const universeMatches =
    universe.status === "reviewable" &&
    isSha256(approvedPolicy.universeHash) &&
    universe.universeHash === approvedPolicy.universeHash &&
    universe.account === approvalAccount;

  if (!universeMatches) {
    blockers.add("target_policy_universe_mismatch");
  }

  const vector = Array.isArray(approvedPolicy.vector)
    ? approvedPolicy.vector
    : [];
  const packet = buildTargetPolicyReviewPacket({
    account: approvedPolicy.account,
    policyVersion: approvedPolicy.policyVersion,
    effectiveServiceDate: approvedPolicy.effectiveServiceDate,
    currentHoldings: universe.rows.map((row) => ({
      name: row.name ?? "",
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      buyability: row.buyability,
    })),
    decisions: vector.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      decision: row.targetWeightBps === 0 ? "zero_target" : "positive_target",
      targetWeightBps: row.targetWeightBps,
      exclusionReason: null,
    })),
  });

  mapPacketBlockers(packet.blockers, blockers, universeMatches);

  if (
    packet.status === "reviewable" &&
    (!isSha256(approvedPolicy.vectorHash) ||
      packet.vectorHash !== approvedPolicy.vectorHash)
  ) {
    blockers.add("target_policy_vector_mismatch");
  }

  const sortedBlockers = [...blockers].sort();
  const ready =
    sortedBlockers.length === 0 &&
    packet.status === "reviewable" &&
    packet.canonicalVector !== null &&
    universe.universeHash !== null &&
    packet.vectorHash !== null;

  return Object.freeze({
    status: ready ? "ready" : "blocked",
    policy: TARGET_POLICY_RESOLVER_POLICY,
    account: requestAccount,
    policyVersion: requestPolicyVersion,
    serviceDate,
    effectiveServiceDate,
    targetVector: ready
      ? Object.freeze(packet.canonicalVector.map(toResolvedVectorRow))
      : null,
    evidence: ready
      ? Object.freeze({
          universeHash: universe.universeHash,
          vectorHash: packet.vectorHash,
        })
      : null,
    blockers: Object.freeze(sortedBlockers),
  } as const);
}

function mapPacketBlockers(
  packetBlockers: readonly { reason: string }[],
  blockers: Set<TargetPolicyResolverBlocker>,
  universeMatches: boolean,
) {
  for (const blocker of packetBlockers) {
    if (blocker.reason === "invalid_account") {
      blockers.add("target_policy_account_invalid");
    } else if (blocker.reason === "invalid_policy_version") {
      blockers.add("target_policy_version_unavailable");
    } else if (blocker.reason === "invalid_effective_service_date") {
      blockers.add("target_policy_effective_date_invalid");
    } else if (blocker.reason === "target_total_invalid") {
      blockers.add("target_policy_total_invalid");
    } else if (blocker.reason === "positive_target_not_buyable") {
      blockers.add("target_policy_instrument_unbuyable");
    } else if (universeMatches) {
      blockers.add("target_policy_vector_mismatch");
    }
  }
}

function toResolvedVectorRow(
  row: TargetPolicyReviewVectorRow,
): ResolvedTargetPolicyVectorRow {
  return Object.freeze({
    instrumentKey: `${row.market}:${row.currency}:${row.ticker}`,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    targetWeightBps: row.targetWeightBps,
    buyability: "buyable",
  });
}

function normalizePolicyVersion(value: string) {
  const version = normalizeText(value);
  return version && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(version)
    ? version
    : null;
}

function normalizeServiceDate(value: string) {
  const serviceDate = normalizeText(value);
  if (!serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return null;
  const [year, month, day] = serviceDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? serviceDate
    : null;
}

function isSha256(value: string) {
  return /^sha256:[0-9a-f]{64}$/.test(String(value ?? ""));
}

function normalizeText(value: string) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
