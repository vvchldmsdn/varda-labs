import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { auditTargetPolicyHoldingUniverses } from "../scripts/lib/target-policy-holding-universe-audit.mjs";
import { TARGET_POLICY_HOLDING_UNIVERSE_SQL } from "../scripts/lib/target-policy-holding-universe-sql.mjs";
import {
  TARGET_POLICY_HOLDING_UNIVERSE_POLICY,
  buildTargetPolicyHoldingUniverse,
} from "../src/lib/target-policy-holding-universe.ts";

describe("target policy Gate B1 holding universe", () => {
  it("builds a deterministic reviewable universe from safe identity rows", () => {
    const forward = buildTargetPolicyHoldingUniverse(validInput());
    const reverse = buildTargetPolicyHoldingUniverse({
      ...validInput(),
      holdings: [...validInput().holdings].reverse(),
    });

    assert.equal(forward.status, "reviewable");
    assert.equal(forward.account, "brokerage");
    assert.equal(forward.summary.holdingCount, 2);
    assert.equal(forward.summary.buyableCount, 2);
    assert.match(forward.universeHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      forward.universeHash,
      "sha256:14f83a0a39c7929a2e197ab55e5ceec40e08142ff99e9dec88afe0d90b637df7",
    );
    assert.deepEqual(forward, reverse);
    assert.deepEqual(forward.rows, [
      safeHolding("AAA"),
      safeHolding("BBB", {
        market: "us",
        currency: "USD",
        name: "BBB US",
      }),
    ]);

    const canonical = JSON.parse(forward.canonicalSerialization);
    assert.deepEqual(Object.keys(canonical), [
      "universePolicyVersion",
      "account",
      "holdings",
    ]);
    assert.deepEqual(Object.keys(canonical.holdings[0]), [
      "market",
      "currency",
      "ticker",
      "buyability",
    ]);
  });

  it("excludes display names from the hash but binds account and identity", () => {
    const baseline = buildTargetPolicyHoldingUniverse(validInput());
    const renamed = buildTargetPolicyHoldingUniverse(
      validInput({ holdings: [holding("AAA", { name: "Renamed" }), validInput().holdings[1]] }),
    );
    const accountChanged = buildTargetPolicyHoldingUniverse(
      validInput({ account: "isa" }),
    );
    const identityChanged = buildTargetPolicyHoldingUniverse(
      validInput({ holdings: [holding("AAC"), validInput().holdings[1]] }),
    );

    assert.equal(renamed.universeHash, baseline.universeHash);
    assert.notEqual(accountChanged.universeHash, baseline.universeHash);
    assert.notEqual(identityChanged.universeHash, baseline.universeHash);
  });

  it("fails closed for all, unknown, and empty account universes", () => {
    for (const account of ["all", "unknown"]) {
      const result = buildTargetPolicyHoldingUniverse(
        validInput({ account }),
      );
      assert.equal(result.status, "blocked");
      assert.equal(result.universeHash, null);
      assert.ok(hasReason(result, "invalid_account"));
    }

    const empty = buildTargetPolicyHoldingUniverse({
      account: "brokerage",
      holdings: [],
    });
    assert.ok(hasReason(empty, "empty_holding_universe"));
    assert.equal(empty.universeHash, null);
  });

  it("retains tickerless holdings as blockers instead of dropping them", () => {
    const result = buildTargetPolicyHoldingUniverse(
      validInput({
        holdings: [
          holding("AAA"),
          holding(null, { name: "Gold holding" }),
        ],
      }),
    );

    assert.equal(result.status, "blocked");
    assert.equal(result.summary.holdingCount, 2);
    assert.equal(result.rows[1].name, "Gold holding");
    assert.equal(result.rows[1].ticker, null);
    assert.equal(result.rows[1].buyability, "tickerless");
    assert.ok(hasReason(result, "incomplete_holding_identity"));
    assert.equal(result.universeHash, null);
  });

  it("blocks unsupported and mismatched structural identities", () => {
    const unsupportedMarket = buildTargetPolicyHoldingUniverse(
      validInput({ holdings: [holding("AAA", { market: "japan", currency: "JPY" })] }),
    );
    const unsupportedCurrency = buildTargetPolicyHoldingUniverse(
      validInput({ holdings: [holding("AAA", { currency: "EUR" })] }),
    );
    const mismatchedPair = buildTargetPolicyHoldingUniverse(
      validInput({ holdings: [holding("AAA", { market: "korea", currency: "USD" })] }),
    );

    assert.ok(hasReason(unsupportedMarket, "unsupported_market"));
    assert.ok(hasReason(unsupportedCurrency, "unsupported_currency"));
    assert.ok(
      hasReason(mismatchedPair, "unsupported_market_currency_pair"),
    );
    assert.equal(mismatchedPair.rows[0].buyability, "not_buyable");
  });

  it("blocks duplicate exact identities without merging rows", () => {
    const result = buildTargetPolicyHoldingUniverse(
      validInput({
        holdings: [holding("AAA"), holding("AAA", { name: "Second lot" })],
      }),
    );

    assert.equal(result.status, "blocked");
    assert.equal(result.rows.length, 2);
    assert.equal(
      result.blockers.filter(
        (row) => row.reason === "duplicate_holding_identity",
      ).length,
      2,
    );
    assert.equal(result.universeHash, null);
  });

  it("keeps the safe DTO and query projection narrow", () => {
    const result = buildTargetPolicyHoldingUniverse(validInput());
    const querySource = readFileSync(
      "src/db/queries/target-policy-holding-universe.ts",
      "utf8",
    );
    const pureSource = readFileSync(
      "src/lib/target-policy-holding-universe.ts",
      "utf8",
    );
    const serializationSource = readFileSync(
      "src/lib/target-policy-holding-universe-serialization.ts",
      "utf8",
    );
    const rulesSource = readFileSync(
      "src/lib/target-policy-holding-universe-rules.ts",
      "utf8",
    );
    const projection = querySource.match(
      /\.select\(\{([\s\S]*?)\}\)\s*\.from\(assets\)/,
    )?.[1];
    const sqlProjection = TARGET_POLICY_HOLDING_UNIVERSE_SQL.split(
      /\bfrom assets\b/i,
    )[0];

    assert.deepEqual(Object.keys(result.rows[0]), [
      "name",
      "market",
      "currency",
      "ticker",
      "buyability",
    ]);
    assert.doesNotMatch(
      JSON.stringify(result),
      /legacy|canonical.?owner|authorization|api[_-]?key|secret|token/i,
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    assert.ok(projection);
    assert.doesNotMatch(
      projection,
      /\bid\b|owner|legacy|target|price|quantity|fractional|provider|secret|token/i,
    );
    assert.doesNotMatch(
      sqlProjection,
      /\bid\b|owner|legacy|target|price|quantity|fractional|provider|secret|token/i,
    );
    assert.match(querySource, /assets\.quantity/);
    assert.match(querySource, /assets\.fractionalKrwValue/);
    assert.match(querySource, /^import "server-only";/);
    assert.doesNotMatch(
      querySource,
      /assetGroups|assetGroupMembers|livePriceQuotes|currentPrice|targetWeight|fetch\s*\(|\/api\//,
    );
    assert.doesNotMatch(
      `${querySource}\n${pureSource}\n${rulesSource}\n${serializationSource}\n${TARGET_POLICY_HOLDING_UNIVERSE_SQL}`,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
    assert.equal(
      TARGET_POLICY_HOLDING_UNIVERSE_POLICY.currentHoldingCriterion,
      "quantity_gt_zero_or_fractional_krw_value_gt_zero",
    );
  });

  it("audits every named account without treating expected blockers as writes", () => {
    const result = auditTargetPolicyHoldingUniverses({
      holdingsByAccount: {
        brokerage: [holding(null, { name: "Gold holding" })],
        isa: [holding("AAA")],
        irp: [holding("BBB")],
      },
      beforeRowCount: 3,
      afterRowCount: 3,
    });

    assert.equal(result.status, "passed");
    assert.deepEqual(result.summary.reviewableAccounts, ["isa", "irp"]);
    assert.deepEqual(result.summary.blockedAccounts, ["brokerage"]);
    assert.equal(result.databaseRowCounts.unchanged, true);
    assert.equal(result.boundaries.databaseWrites, 0);
    assert.equal(result.boundaries.providerCalls, 0);
    assert.equal(result.boundaries.rawTargetReads, 0);
  });
});

function hasReason(result, reason) {
  return result.blockers.some((row) => row.reason === reason);
}

function validInput(overrides = {}) {
  return {
    account: "brokerage",
    holdings: [
      holding("AAA"),
      holding("BBB", { market: "us", currency: "USD", name: "BBB US" }),
    ],
    ...overrides,
  };
}

function holding(ticker, overrides = {}) {
  return {
    name: ticker ? `${ticker} Holding` : "Manual holding",
    market: "korea",
    currency: "KRW",
    ticker,
    ...overrides,
  };
}

function safeHolding(ticker, overrides = {}) {
  return {
    ...holding(ticker, overrides),
    buyability: "buyable",
  };
}
