import type {
  NormalizedTargetPolicyReviewDecision,
  NormalizedTargetPolicyReviewHolding,
} from "./target-policy-review-input.ts";

export type TargetPolicyReviewBlockerReason =
  | "invalid_account"
  | "invalid_policy_version"
  | "invalid_effective_service_date"
  | "empty_holding_universe"
  | "invalid_holding_name"
  | "incomplete_holding_identity"
  | "invalid_buyability"
  | "duplicate_holding_identity"
  | "empty_decisions"
  | "incomplete_decision_identity"
  | "invalid_decision"
  | "duplicate_decision_identity"
  | "missing_holding_decision"
  | "external_instrument"
  | "invalid_target_weight"
  | "positive_target_not_buyable"
  | "zero_target_weight_mismatch"
  | "excluded_target_weight_present"
  | "missing_exclusion_reason"
  | "unexpected_exclusion_reason"
  | "target_total_invalid";

export type TargetPolicyReviewBlocker = Readonly<{
  reason: TargetPolicyReviewBlockerReason;
  instrumentKey: string | null;
  instrumentName: string | null;
}>;

export function validateTargetPolicyReviewMetadata(
  input: {
    account: string | null;
    policyVersion: string | null;
    effectiveServiceDate: string | null;
    currentHoldings: readonly NormalizedTargetPolicyReviewHolding[];
    decisions: readonly NormalizedTargetPolicyReviewDecision[];
  },
  blockers: TargetPolicyReviewBlocker[],
) {
  if (!input.account) addReviewBlocker(blockers, "invalid_account", null, null);
  if (!input.policyVersion) {
    addReviewBlocker(blockers, "invalid_policy_version", null, null);
  }
  if (!input.effectiveServiceDate) {
    addReviewBlocker(blockers, "invalid_effective_service_date", null, null);
  }
  if (input.currentHoldings.length === 0) {
    addReviewBlocker(blockers, "empty_holding_universe", null, null);
  }
  if (input.decisions.length === 0) {
    addReviewBlocker(blockers, "empty_decisions", null, null);
  }
}

export function validateTargetPolicyReviewHoldings(
  rows: readonly NormalizedTargetPolicyReviewHolding[],
  blockers: TargetPolicyReviewBlocker[],
) {
  const counts = countReviewKeys(rows);
  for (const row of rows) {
    if (!row.name) {
      addReviewBlocker(blockers, "invalid_holding_name", row.instrumentKey, null);
    }
    if (!row.instrumentKey) {
      addReviewBlocker(
        blockers,
        "incomplete_holding_identity",
        null,
        row.name,
      );
    }
    if (!row.buyability) {
      addReviewBlocker(
        blockers,
        "invalid_buyability",
        row.instrumentKey,
        row.name,
      );
    }
    if (row.instrumentKey && (counts.get(row.instrumentKey) ?? 0) > 1) {
      addReviewBlocker(
        blockers,
        "duplicate_holding_identity",
        row.instrumentKey,
        row.name,
      );
    }
  }
}

export function validateTargetPolicyReviewDecisions(
  rows: readonly NormalizedTargetPolicyReviewDecision[],
  blockers: TargetPolicyReviewBlocker[],
) {
  const counts = countReviewKeys(rows);
  for (const row of rows) {
    if (!row.instrumentKey) {
      addReviewBlocker(blockers, "incomplete_decision_identity", null, null);
    }
    if (!row.decision) {
      addReviewBlocker(blockers, "invalid_decision", row.instrumentKey, null);
    }
    if (row.instrumentKey && (counts.get(row.instrumentKey) ?? 0) > 1) {
      addReviewBlocker(
        blockers,
        "duplicate_decision_identity",
        row.instrumentKey,
        null,
      );
    }
  }
}

export function validateTargetPolicyMatchedDecision(
  holding: NormalizedTargetPolicyReviewHolding,
  decision: NormalizedTargetPolicyReviewDecision,
  blockers: TargetPolicyReviewBlocker[],
) {
  if (decision.decision === "positive_target") {
    if (!validPositiveWeight(decision.targetWeightBps)) {
      addReviewBlocker(
        blockers,
        "invalid_target_weight",
        holding.instrumentKey,
        holding.name,
      );
    }
    if (holding.buyability !== "buyable") {
      addReviewBlocker(
        blockers,
        "positive_target_not_buyable",
        holding.instrumentKey,
        holding.name,
      );
    }
    rejectUnexpectedExclusionReason(holding, decision, blockers);
  } else if (decision.decision === "zero_target") {
    if (decision.targetWeightBps !== 0) {
      addReviewBlocker(
        blockers,
        "zero_target_weight_mismatch",
        holding.instrumentKey,
        holding.name,
      );
    }
    rejectUnexpectedExclusionReason(holding, decision, blockers);
  } else if (decision.decision === "excluded") {
    if (decision.targetWeightState !== "null") {
      addReviewBlocker(
        blockers,
        "excluded_target_weight_present",
        holding.instrumentKey,
        holding.name,
      );
    }
    if (!decision.exclusionReason) {
      addReviewBlocker(
        blockers,
        "missing_exclusion_reason",
        holding.instrumentKey,
        holding.name,
      );
    }
  }
}

export function uniqueTargetPolicyRowsByKey<
  T extends { instrumentKey: string | null },
>(rows: readonly T[]) {
  const counts = countReviewKeys(rows);
  return new Map(
    rows
      .filter(
        (row): row is T & { instrumentKey: string } =>
          Boolean(row.instrumentKey) &&
          counts.get(row.instrumentKey as string) === 1,
      )
      .map((row) => [row.instrumentKey, row]),
  );
}

export function addReviewBlocker(
  blockers: TargetPolicyReviewBlocker[],
  reason: TargetPolicyReviewBlockerReason,
  instrumentKey: string | null,
  instrumentName: string | null,
) {
  blockers.push(Object.freeze({ reason, instrumentKey, instrumentName }));
}

export function sortAndDedupeReviewBlockers(
  blockers: readonly TargetPolicyReviewBlocker[],
) {
  const unique = new Map(
    blockers.map((row) => [
      JSON.stringify([row.reason, row.instrumentKey, row.instrumentName]),
      row,
    ]),
  );
  return [...unique.values()].sort(
    (left, right) =>
      left.reason.localeCompare(right.reason) ||
      String(left.instrumentKey).localeCompare(String(right.instrumentKey)) ||
      String(left.instrumentName).localeCompare(String(right.instrumentName)),
  );
}

function countReviewKeys(rows: readonly { instrumentKey: string | null }[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.instrumentKey) {
      counts.set(row.instrumentKey, (counts.get(row.instrumentKey) ?? 0) + 1);
    }
  }
  return counts;
}

function validPositiveWeight(value: number | null) {
  return (
    value !== null &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= 10_000
  );
}

function rejectUnexpectedExclusionReason(
  holding: NormalizedTargetPolicyReviewHolding,
  decision: NormalizedTargetPolicyReviewDecision,
  blockers: TargetPolicyReviewBlocker[],
) {
  if (decision.exclusionReason) {
    addReviewBlocker(
      blockers,
      "unexpected_exclusion_reason",
      holding.instrumentKey,
      holding.name,
    );
  }
}
