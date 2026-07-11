import { createHash } from "node:crypto";

export type TargetPolicyUniverseHashRow = Readonly<{
  market: string | null;
  currency: string | null;
  ticker: string | null;
  buyability: string;
}>;

export function canonicalizeTargetPolicyHoldingUniverse(input: {
  universePolicyVersion: string;
  account: string;
  holdings: readonly TargetPolicyUniverseHashRow[];
}) {
  return JSON.stringify({
    universePolicyVersion: input.universePolicyVersion,
    account: input.account,
    holdings: [...input.holdings]
      .sort(compareTargetPolicyUniverseIdentityRows)
      .map(({ market, currency, ticker, buyability }) => ({
        market,
        currency,
        ticker,
        buyability,
      })),
  });
}

export function hashTargetPolicyHoldingUniverse(serialized: string) {
  return `sha256:${createHash("sha256").update(serialized).digest("hex")}`;
}

export function compareTargetPolicyUniverseIdentityRows(
  left: Pick<TargetPolicyUniverseHashRow, "market" | "currency" | "ticker">,
  right: Pick<TargetPolicyUniverseHashRow, "market" | "currency" | "ticker">,
) {
  return (
    String(left.market).localeCompare(String(right.market)) ||
    String(left.currency).localeCompare(String(right.currency)) ||
    String(left.ticker).localeCompare(String(right.ticker))
  );
}
