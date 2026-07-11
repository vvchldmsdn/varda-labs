import type {
  AdditionalContributionAccount,
  AdditionalContributionBlockerReason,
  AdditionalContributionBuyability,
  AdditionalContributionHolding,
} from "./additional-contribution-allocator.ts";

export type AdditionalContributionNormalizedHolding =
  AdditionalContributionHolding &
    Readonly<{
      sourceIndex: number;
      instrumentKey: string | null;
      market: string | null;
      currency: string | null;
      ticker: string | null;
    }>;

export function prepareAdditionalContributionInput(
  input: {
    account: string;
    targetPolicyVersion: string;
    cashAmountKrw: number;
    holdings: readonly AdditionalContributionHolding[];
  },
  policy: {
    supportedAccounts: readonly AdditionalContributionAccount[];
    targetWeightTotalBps: number;
  },
) {
  const blockers: Array<{
    reason: AdditionalContributionBlockerReason;
    sourceIndex: number | null;
  }> = [];
  const account = normalizeAccount(input.account, policy.supportedAccounts);
  const targetPolicyVersion = normalizePolicyVersion(input.targetPolicyVersion);

  if (!account) blockers.push(additionalContributionBlocker("invalid_account", null));
  if (!targetPolicyVersion) {
    blockers.push(
      additionalContributionBlocker("invalid_target_policy_version", null),
    );
  }
  if (!Number.isSafeInteger(input.cashAmountKrw) || input.cashAmountKrw <= 0) {
    blockers.push(
      additionalContributionBlocker("invalid_cash_amount", null),
    );
  }
  if (!Array.isArray(input.holdings) || input.holdings.length === 0) {
    blockers.push(
      additionalContributionBlocker("empty_valuation_universe", null),
    );
  }

  const holdings = normalizeHoldings(input.holdings, blockers);
  const targetWeightTotalBps = holdings.reduce(
    (sum, holding) => sum + holding.targetWeightBps,
    0,
  );
  if (
    holdings.length > 0 &&
    targetWeightTotalBps !== policy.targetWeightTotalBps
  ) {
    blockers.push(
      additionalContributionBlocker("target_policy_incomplete", null),
    );
  }

  return { account, targetPolicyVersion, holdings, blockers };
}

export function additionalContributionBlocker(
  reason: AdditionalContributionBlockerReason,
  sourceIndex: number | null,
) {
  return Object.freeze({ reason, sourceIndex });
}

function normalizeHoldings(
  rows: readonly AdditionalContributionHolding[],
  blockers: Array<{
    reason: AdditionalContributionBlockerReason;
    sourceIndex: number | null;
  }>,
) {
  const seen = new Set<string>();
  const normalized: AdditionalContributionNormalizedHolding[] = [];

  rows.forEach((row, sourceIndex) => {
    const market = normalizeComponent(row.market, "lower");
    const currency = normalizeComponent(row.currency, "upper");
    const ticker = normalizeComponent(row.ticker, "upper");
    const instrumentKey =
      market && currency && ticker ? `${market}:${currency}:${ticker}` : null;

    if (!Number.isFinite(row.currentValueKrw) || row.currentValueKrw < 0) {
      blockers.push(
        additionalContributionBlocker("invalid_current_value", sourceIndex),
      );
    }
    if (
      !Number.isInteger(row.targetWeightBps) ||
      row.targetWeightBps < 0 ||
      row.targetWeightBps > 10_000
    ) {
      blockers.push(
        additionalContributionBlocker("invalid_target_weight", sourceIndex),
      );
    }
    if (!isBuyability(row.buyability)) {
      blockers.push(
        additionalContributionBlocker("invalid_buyability", sourceIndex),
      );
    }
    if (row.buyability === "buyable" && instrumentKey === null) {
      blockers.push(
        additionalContributionBlocker(
          "invalid_instrument_identity",
          sourceIndex,
        ),
      );
    }
    if (instrumentKey && seen.has(instrumentKey)) {
      blockers.push(
        additionalContributionBlocker("duplicate_instrument", sourceIndex),
      );
    }
    if (instrumentKey) seen.add(instrumentKey);

    normalized.push({
      ...row,
      sourceIndex,
      instrumentKey,
      market,
      currency,
      ticker,
    });
  });

  return normalized;
}

function normalizeAccount(
  value: string,
  supportedAccounts: readonly AdditionalContributionAccount[],
) {
  const account = String(value ?? "").trim().toLowerCase();
  return supportedAccounts.includes(account as AdditionalContributionAccount)
    ? (account as AdditionalContributionAccount)
    : null;
}

function normalizePolicyVersion(value: string) {
  const version = String(value ?? "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(version) ? version : null;
}

function normalizeComponent(
  value: string | null,
  casing: "lower" | "upper",
) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  return casing === "lower"
    ? normalized.toLowerCase()
    : normalized.toUpperCase();
}

function isBuyability(value: string): value is AdditionalContributionBuyability {
  return (
    value === "buyable" ||
    value === "not_buyable" ||
    value === "tickerless" ||
    value === "unsupported_market" ||
    value === "unsupported_currency"
  );
}
