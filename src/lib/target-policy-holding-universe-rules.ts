export type TargetPolicyUniverseBlockerReason =
  | "invalid_account"
  | "empty_holding_universe"
  | "invalid_holding_name"
  | "incomplete_holding_identity"
  | "unsupported_market"
  | "unsupported_currency"
  | "unsupported_market_currency_pair"
  | "duplicate_holding_identity";

export type TargetPolicyStructuralBuyability =
  | "buyable"
  | "not_buyable"
  | "tickerless"
  | "unsupported_market"
  | "unsupported_currency";

export type TargetPolicyUniverseNormalizedRow = Readonly<{
  name: string | null;
  market: string | null;
  currency: string | null;
  ticker: string | null;
  instrumentKey: string | null;
  buyability: TargetPolicyStructuralBuyability;
}>;

export type TargetPolicyUniverseBlocker = Readonly<{
  reason: TargetPolicyUniverseBlockerReason;
  name: string | null;
  market: string | null;
  currency: string | null;
  ticker: string | null;
}>;

export function validateTargetPolicyUniverseRows(
  rows: readonly TargetPolicyUniverseNormalizedRow[],
  blockers: TargetPolicyUniverseBlocker[],
) {
  const identityCounts = countCompleteIdentities(rows);
  for (const row of rows) {
    if (!row.name) addUniverseBlocker(blockers, "invalid_holding_name", row);
    if (!row.instrumentKey) {
      addUniverseBlocker(blockers, "incomplete_holding_identity", row);
    }
    if (row.buyability === "unsupported_market") {
      addUniverseBlocker(blockers, "unsupported_market", row);
    } else if (row.buyability === "unsupported_currency") {
      addUniverseBlocker(blockers, "unsupported_currency", row);
    } else if (row.buyability === "not_buyable") {
      addUniverseBlocker(
        blockers,
        "unsupported_market_currency_pair",
        row,
      );
    }
    if (
      row.instrumentKey &&
      (identityCounts.get(row.instrumentKey) ?? 0) > 1
    ) {
      addUniverseBlocker(blockers, "duplicate_holding_identity", row);
    }
  }
}

export function addUniverseBlocker(
  blockers: TargetPolicyUniverseBlocker[],
  reason: TargetPolicyUniverseBlockerReason,
  row: TargetPolicyUniverseNormalizedRow | null,
) {
  blockers.push({
    reason,
    name: row?.name ?? null,
    market: row?.market ?? null,
    currency: row?.currency ?? null,
    ticker: row?.ticker ?? null,
  });
}

export function sortAndDedupeUniverseBlockers(
  blockers: readonly TargetPolicyUniverseBlocker[],
) {
  const unique = new Map(
    blockers.map((row) => [JSON.stringify(row), row] as const),
  );
  return [...unique.values()].sort(
    (left, right) =>
      left.reason.localeCompare(right.reason) ||
      String(left.market).localeCompare(String(right.market)) ||
      String(left.currency).localeCompare(String(right.currency)) ||
      String(left.ticker).localeCompare(String(right.ticker)) ||
      String(left.name).localeCompare(String(right.name)),
  );
}

function countCompleteIdentities(
  rows: readonly TargetPolicyUniverseNormalizedRow[],
) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.instrumentKey) {
      counts.set(
        row.instrumentKey,
        (counts.get(row.instrumentKey) ?? 0) + 1,
      );
    }
  }
  return counts;
}
