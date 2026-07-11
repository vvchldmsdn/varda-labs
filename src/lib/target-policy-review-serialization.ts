import { createHash } from "node:crypto";

export type TargetPolicyReviewVectorRow = Readonly<{
  market: string;
  currency: string;
  ticker: string;
  targetWeightBps: number;
}>;

export function canonicalizeTargetPolicyVector(input: {
  policyId: string;
  policyVersion: string;
  account: string;
  effectiveServiceDate: string;
  vector: readonly TargetPolicyReviewVectorRow[];
}) {
  return JSON.stringify({
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    account: input.account,
    effectiveServiceDate: input.effectiveServiceDate,
    vector: [...input.vector].sort(compareTargetPolicyVectorRows),
  });
}

export function hashTargetPolicyVector(serialized: string) {
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

export function compareTargetPolicyVectorRows(
  left: Pick<TargetPolicyReviewVectorRow, "market" | "currency" | "ticker">,
  right: Pick<TargetPolicyReviewVectorRow, "market" | "currency" | "ticker">,
) {
  return (
    left.market.localeCompare(right.market) ||
    left.currency.localeCompare(right.currency) ||
    left.ticker.localeCompare(right.ticker)
  );
}
