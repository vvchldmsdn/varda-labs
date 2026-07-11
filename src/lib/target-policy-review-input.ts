export const TARGET_POLICY_REVIEW_ACCOUNTS = Object.freeze([
  "brokerage",
  "isa",
  "irp",
] as const);

export const TARGET_POLICY_REVIEW_DECISIONS = Object.freeze([
  "positive_target",
  "zero_target",
  "excluded",
] as const);

export const TARGET_POLICY_REVIEW_BUYABILITY = Object.freeze([
  "buyable",
  "not_buyable",
  "tickerless",
  "unsupported_market",
  "unsupported_currency",
] as const);

export type TargetPolicyReviewAccount =
  (typeof TARGET_POLICY_REVIEW_ACCOUNTS)[number];
export type TargetPolicyReviewDecision =
  (typeof TARGET_POLICY_REVIEW_DECISIONS)[number];
export type TargetPolicyReviewBuyability =
  (typeof TARGET_POLICY_REVIEW_BUYABILITY)[number];

export type TargetPolicyReviewHolding = Readonly<{
  name: string;
  market: string | null;
  currency: string | null;
  ticker: string | null;
  buyability: string;
}>;

export type TargetPolicyReviewDecisionRow = Readonly<{
  market: string | null;
  currency: string | null;
  ticker: string | null;
  decision: string;
  targetWeightBps: number | null;
  exclusionReason: string | null;
}>;

export type NormalizedTargetPolicyReviewHolding = Readonly<{
  sourceIndex: number;
  name: string | null;
  market: string | null;
  currency: string | null;
  ticker: string | null;
  instrumentKey: string | null;
  buyability: TargetPolicyReviewBuyability | null;
}>;

export type NormalizedTargetPolicyReviewDecision = Readonly<{
  sourceIndex: number;
  market: string | null;
  currency: string | null;
  ticker: string | null;
  instrumentKey: string | null;
  decision: TargetPolicyReviewDecision | null;
  targetWeightBps: number | null;
  targetWeightState: "null" | "finite" | "invalid";
  exclusionReason: string | null;
}>;

export function normalizeTargetPolicyReviewInput(input: {
  account: string;
  policyVersion: string;
  effectiveServiceDate: string;
  currentHoldings: readonly TargetPolicyReviewHolding[];
  decisions: readonly TargetPolicyReviewDecisionRow[];
}) {
  return Object.freeze({
    account: normalizeAccount(input.account),
    policyVersion: normalizePolicyVersion(input.policyVersion),
    effectiveServiceDate: normalizeServiceDate(input.effectiveServiceDate),
    currentHoldings: Object.freeze(
      input.currentHoldings.map(normalizeHolding),
    ),
    decisions: Object.freeze(input.decisions.map(normalizeDecisionRow)),
  });
}

function normalizeHolding(
  holding: TargetPolicyReviewHolding,
  sourceIndex: number,
): NormalizedTargetPolicyReviewHolding {
  const identity = normalizeIdentity(holding);
  const buyability = String(holding.buyability ?? "")
    .trim()
    .toLowerCase();

  return Object.freeze({
    sourceIndex,
    name: normalizeNullableText(holding.name),
    ...identity,
    buyability: TARGET_POLICY_REVIEW_BUYABILITY.includes(
      buyability as TargetPolicyReviewBuyability,
    )
      ? (buyability as TargetPolicyReviewBuyability)
      : null,
  });
}

function normalizeDecisionRow(
  row: TargetPolicyReviewDecisionRow,
  sourceIndex: number,
): NormalizedTargetPolicyReviewDecision {
  const identity = normalizeIdentity(row);
  const decision = String(row.decision ?? "").trim().toLowerCase();
  const targetWeightState =
    row.targetWeightBps === null
      ? "null"
      : Number.isFinite(row.targetWeightBps)
        ? "finite"
        : "invalid";

  return Object.freeze({
    sourceIndex,
    ...identity,
    decision: TARGET_POLICY_REVIEW_DECISIONS.includes(
      decision as TargetPolicyReviewDecision,
    )
      ? (decision as TargetPolicyReviewDecision)
      : null,
    targetWeightBps:
      targetWeightState === "finite" ? row.targetWeightBps : null,
    targetWeightState,
    exclusionReason: normalizeNullableText(row.exclusionReason),
  });
}

function normalizeIdentity(value: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}) {
  const market = normalizeNullableText(value.market)?.toLowerCase() ?? null;
  const currency = normalizeNullableText(value.currency)?.toUpperCase() ?? null;
  const ticker = normalizeNullableText(value.ticker)?.toUpperCase() ?? null;

  return {
    market,
    currency,
    ticker,
    instrumentKey:
      market && currency && ticker ? `${market}:${currency}:${ticker}` : null,
  };
}

function normalizeAccount(value: string): TargetPolicyReviewAccount | null {
  const account = String(value ?? "").trim().toLowerCase();
  return TARGET_POLICY_REVIEW_ACCOUNTS.includes(
    account as TargetPolicyReviewAccount,
  )
    ? (account as TargetPolicyReviewAccount)
    : null;
}

function normalizePolicyVersion(value: string) {
  const version = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(version) ? version : null;
}

function normalizeServiceDate(value: string) {
  const serviceDate = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) return null;
  const [year, month, day] = serviceDate.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
    ? serviceDate
    : null;
}

function normalizeNullableText(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
