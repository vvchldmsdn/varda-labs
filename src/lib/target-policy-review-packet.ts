import {
  normalizeTargetPolicyReviewInput,
  type NormalizedTargetPolicyReviewDecision,
  type NormalizedTargetPolicyReviewHolding,
  type TargetPolicyReviewDecisionRow,
  type TargetPolicyReviewHolding,
} from "./target-policy-review-input.ts";
import {
  addReviewBlocker,
  sortAndDedupeReviewBlockers,
  uniqueTargetPolicyRowsByKey,
  validateTargetPolicyMatchedDecision,
  validateTargetPolicyReviewDecisions,
  validateTargetPolicyReviewHoldings,
  validateTargetPolicyReviewMetadata,
  type TargetPolicyReviewBlocker,
} from "./target-policy-review-rules.ts";
import {
  canonicalizeTargetPolicyVector,
  compareTargetPolicyVectorRows,
  hashTargetPolicyVector,
  type TargetPolicyReviewVectorRow,
} from "./target-policy-review-serialization.ts";

export const TARGET_POLICY_REVIEW_PACKET_POLICY = Object.freeze({
  version: "target_policy_gate_b0_packet_v1",
  policyId: "account_scoped_explicit_instrument_targets_v1",
  targetWeightUnit: "integer_basis_points",
  targetWeightTotalBps: 10_000,
  approvalState: "unapproved",
  universeAuthority: "caller_supplied_unverified",
  productionApproval: "forbidden_without_reviewed_universe",
  rawTargetInference: "forbidden",
  persistence: "forbidden",
} as const);

export function buildTargetPolicyReviewPacket(input: {
  account: string;
  policyVersion: string;
  effectiveServiceDate: string;
  currentHoldings: readonly TargetPolicyReviewHolding[];
  decisions: readonly TargetPolicyReviewDecisionRow[];
}) {
  const normalized = normalizeTargetPolicyReviewInput(input);
  const blockers: TargetPolicyReviewBlocker[] = [];

  validateTargetPolicyReviewMetadata(normalized, blockers);
  validateTargetPolicyReviewHoldings(normalized.currentHoldings, blockers);
  validateTargetPolicyReviewDecisions(normalized.decisions, blockers);

  const holdingsByKey = uniqueTargetPolicyRowsByKey(normalized.currentHoldings);
  const decisionsByKey = uniqueTargetPolicyRowsByKey(normalized.decisions);

  for (const holding of normalized.currentHoldings) {
    if (!holding.instrumentKey) continue;
    const decision = decisionsByKey.get(holding.instrumentKey);
    if (!decision) {
      addReviewBlocker(
        blockers,
        "missing_holding_decision",
        holding.instrumentKey,
        holding.name,
      );
      continue;
    }
    validateTargetPolicyMatchedDecision(holding, decision, blockers);
  }

  for (const decision of normalized.decisions) {
    if (decision.instrumentKey && !holdingsByKey.has(decision.instrumentKey)) {
      addReviewBlocker(
        blockers,
        "external_instrument",
        decision.instrumentKey,
        null,
      );
    }
  }

  const rows = normalized.currentHoldings
    .map((holding) =>
      projectReviewRow(
        holding,
        holding.instrumentKey
          ? decisionsByKey.get(holding.instrumentKey) ?? null
          : null,
      ),
    )
    .sort(compareReviewRows);
  const vector = rows
    .filter(isTargetVectorReviewRow)
    .map(toTargetVectorRow)
    .sort(compareTargetPolicyVectorRows);
  const targetTotalBps = vector.reduce(
    (sum, row) => sum + row.targetWeightBps,
    0,
  );
  if (targetTotalBps !== TARGET_POLICY_REVIEW_PACKET_POLICY.targetWeightTotalBps) {
    addReviewBlocker(blockers, "target_total_invalid", null, null);
  }

  const sortedBlockers = sortAndDedupeReviewBlockers(blockers);
  const reviewable = sortedBlockers.length === 0;
  const canonicalSerialization = reviewable
    ? canonicalizeTargetPolicyVector({
        policyId: TARGET_POLICY_REVIEW_PACKET_POLICY.policyId,
        policyVersion: normalized.policyVersion as string,
        account: normalized.account as string,
        effectiveServiceDate: normalized.effectiveServiceDate as string,
        vector,
      })
    : null;

  return Object.freeze({
    status: reviewable ? "reviewable" : "invalid",
    approvalState: "unapproved",
    policy: TARGET_POLICY_REVIEW_PACKET_POLICY,
    account: normalized.account,
    policyVersion: normalized.policyVersion,
    effectiveServiceDate: normalized.effectiveServiceDate,
    summary: Object.freeze({
      holdingCount: normalized.currentHoldings.length,
      decisionCount: normalized.decisions.length,
      vectorRowCount: vector.length,
      positiveTargetCount: rows.filter(
        (row) => row.decision === "positive_target",
      ).length,
      zeroTargetCount: rows.filter((row) => row.decision === "zero_target")
        .length,
      excludedCount: rows.filter((row) => row.decision === "excluded").length,
      targetTotalBps,
    }),
    rows: Object.freeze(rows.map((row) => Object.freeze(row))),
    canonicalVector: reviewable
      ? Object.freeze(vector.map((row) => Object.freeze(row)))
      : null,
    canonicalSerialization,
    vectorHash: canonicalSerialization
      ? hashTargetPolicyVector(canonicalSerialization)
      : null,
    blockers: Object.freeze(sortedBlockers),
  } as const);
}

function projectReviewRow(
  holding: NormalizedTargetPolicyReviewHolding,
  decision: NormalizedTargetPolicyReviewDecision | null,
) {
  return {
    name: holding.name,
    instrumentKey: holding.instrumentKey,
    market: holding.market,
    currency: holding.currency,
    ticker: holding.ticker,
    buyability: holding.buyability,
    decision: decision?.decision ?? null,
    targetWeightBps: decision?.targetWeightBps ?? null,
    exclusionReason: decision?.exclusionReason ?? null,
  };
}

type ReviewRow = ReturnType<typeof projectReviewRow>;

function isTargetVectorReviewRow(
  row: ReviewRow,
): row is ReviewRow & {
  market: string;
  currency: string;
  ticker: string;
  targetWeightBps: number;
} {
  return (
    (row.decision === "positive_target" || row.decision === "zero_target") &&
    row.market !== null &&
    row.currency !== null &&
    row.ticker !== null &&
    row.targetWeightBps !== null
  );
}

function toTargetVectorRow(row: ReviewRow): TargetPolicyReviewVectorRow {
  return {
    market: row.market as string,
    currency: row.currency as string,
    ticker: row.ticker as string,
    targetWeightBps: row.targetWeightBps as number,
  };
}

function compareReviewRows(left: ReviewRow, right: ReviewRow) {
  return (
    String(left.instrumentKey).localeCompare(String(right.instrumentKey)) ||
    String(left.name).localeCompare(String(right.name))
  );
}
