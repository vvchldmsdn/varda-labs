import {
  canonicalizeTargetPolicyHoldingUniverse,
  compareTargetPolicyUniverseIdentityRows,
  hashTargetPolicyHoldingUniverse,
} from "./target-policy-holding-universe-serialization.ts";
import {
  addUniverseBlocker,
  sortAndDedupeUniverseBlockers,
  validateTargetPolicyUniverseRows,
  type TargetPolicyStructuralBuyability,
  type TargetPolicyUniverseBlocker,
  type TargetPolicyUniverseNormalizedRow,
} from "./target-policy-holding-universe-rules.ts";

const TARGET_POLICY_UNIVERSE_ACCOUNTS = ["brokerage", "isa", "irp"] as const;
const SUPPORTED_MARKETS = new Set(["korea", "us"]);
const SUPPORTED_CURRENCIES = new Set(["KRW", "USD"]);
const SUPPORTED_MARKET_CURRENCY_PAIRS = new Set(["korea:KRW", "us:USD"]);

export const TARGET_POLICY_HOLDING_UNIVERSE_POLICY = Object.freeze({
  version: "target_policy_holding_universe_v1",
  currentHoldingCriterion:
    "quantity_gt_zero_or_fractional_krw_value_gt_zero",
  identity: "normalized_market_currency_ticker",
  supportedPairs: Object.freeze(["korea:KRW", "us:USD"]),
  allAccount: "forbidden",
  duplicateIdentity: "block_without_merge",
  productRouteUse: "forbidden_until_tenant_scope",
} as const);

export type TargetPolicyUniverseAccount =
  (typeof TARGET_POLICY_UNIVERSE_ACCOUNTS)[number];

export type { TargetPolicyStructuralBuyability } from "./target-policy-holding-universe-rules.ts";

export type TargetPolicyUniverseSourceRow = Readonly<{
  name: string | null;
  market: string | null;
  currency: string | null;
  ticker: string | null;
}>;

export function buildTargetPolicyHoldingUniverse(input: {
  account: string;
  holdings: readonly TargetPolicyUniverseSourceRow[];
}) {
  const account = normalizeTargetPolicyUniverseAccount(input.account);
  const rows = input.holdings.map(normalizeUniverseRow).sort(compareUniverseRows);
  const blockers: TargetPolicyUniverseBlocker[] = [];

  if (!account) addUniverseBlocker(blockers, "invalid_account", null);
  if (rows.length === 0) {
    addUniverseBlocker(blockers, "empty_holding_universe", null);
  }

  validateTargetPolicyUniverseRows(rows, blockers);

  const sortedBlockers = sortAndDedupeUniverseBlockers(blockers);
  const reviewable = sortedBlockers.length === 0;
  const safeRows = rows.map(projectSafeUniverseRow);
  const canonicalSerialization =
    reviewable && account
      ? canonicalizeTargetPolicyHoldingUniverse({
          universePolicyVersion:
            TARGET_POLICY_HOLDING_UNIVERSE_POLICY.version,
          account,
          holdings: safeRows,
        })
      : null;

  return Object.freeze({
    status: reviewable ? "reviewable" : "blocked",
    account,
    policy: TARGET_POLICY_HOLDING_UNIVERSE_POLICY,
    summary: Object.freeze({
      holdingCount: safeRows.length,
      buyableCount: safeRows.filter((row) => row.buyability === "buyable")
        .length,
      blockedHoldingCount: safeRows.filter(
        (row) => row.buyability !== "buyable",
      ).length,
    }),
    rows: Object.freeze(safeRows.map((row) => Object.freeze(row))),
    canonicalSerialization,
    universeHash: canonicalSerialization
      ? hashTargetPolicyHoldingUniverse(canonicalSerialization)
      : null,
    blockers: Object.freeze(sortedBlockers.map(Object.freeze)),
  } as const);
}

export function normalizeTargetPolicyUniverseAccount(
  value: string,
): TargetPolicyUniverseAccount | null {
  const account = String(value ?? "").trim().toLowerCase();
  return TARGET_POLICY_UNIVERSE_ACCOUNTS.includes(
    account as TargetPolicyUniverseAccount,
  )
    ? (account as TargetPolicyUniverseAccount)
    : null;
}

function normalizeUniverseRow(
  row: TargetPolicyUniverseSourceRow,
): TargetPolicyUniverseNormalizedRow {
  const name = normalizeText(row.name);
  const market = normalizeText(row.market)?.toLowerCase() ?? null;
  const currency = normalizeText(row.currency)?.toUpperCase() ?? null;
  const ticker = normalizeText(row.ticker)?.toUpperCase() ?? null;
  const instrumentKey =
    market && currency && ticker ? `${market}:${currency}:${ticker}` : null;

  return Object.freeze({
    name,
    market,
    currency,
    ticker,
    instrumentKey,
    buyability: classifyStructuralBuyability({ market, currency, ticker }),
  });
}

function classifyStructuralBuyability(row: {
  market: string | null;
  currency: string | null;
  ticker: string | null;
}): TargetPolicyStructuralBuyability {
  if (!row.ticker) return "tickerless";
  if (!row.market || !SUPPORTED_MARKETS.has(row.market)) {
    return "unsupported_market";
  }
  if (!row.currency || !SUPPORTED_CURRENCIES.has(row.currency)) {
    return "unsupported_currency";
  }
  return SUPPORTED_MARKET_CURRENCY_PAIRS.has(`${row.market}:${row.currency}`)
    ? "buyable"
    : "not_buyable";
}

function projectSafeUniverseRow(row: TargetPolicyUniverseNormalizedRow) {
  return {
    name: row.name,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
    buyability: row.buyability,
  };
}

function compareUniverseRows(
  left: TargetPolicyUniverseNormalizedRow,
  right: TargetPolicyUniverseNormalizedRow,
) {
  return (
    compareTargetPolicyUniverseIdentityRows(left, right) ||
    String(left.name).localeCompare(String(right.name))
  );
}

function normalizeText(value: string | null) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}
