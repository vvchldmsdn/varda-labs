import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ADDITIONAL_CONTRIBUTION_POLICY,
  allocateAdditionalContribution,
} from "../src/lib/additional-contribution-allocator.ts";

describe("additional contribution explicit-target allocator", () => {
  it("allocates integer KRW in proportion to positive post-top-up deficits", () => {
    const result = allocateAdditionalContribution({
      account: "brokerage",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 3_000,
      holdings: [
        holding("AAA", 1_000, 4_000),
        holding("BBB", 1_000, 3_000),
        holding("CCC", 8_000, 3_000),
      ],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.currentPortfolioTotalKrw, 10_000);
    assert.equal(result.postTopupTotalKrw, 13_000);
    assert.equal(result.totalCappedDeficitKrw, 7_100);
    assert.deepEqual(
      result.allocations.map((row) => [row.ticker, row.allocationKrw]),
      [
        ["AAA", 1_775],
        ["BBB", 1_225],
        ["CCC", 0],
      ],
    );
    assert.equal(result.totalAllocatedKrw, 3_000);
    assert.equal(result.residualCashKrw, 0);
    assert.ok(
      result.allocations.every(
        (row) => row.allocationKrw <= row.cappedDeficitKrw + 1e-6,
      ),
    );
  });

  it("uses normalized instrument identity for deterministic remainder ties", () => {
    const base = {
      account: "isa",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 1_001,
    };
    const rows = [
      holding("BBB", 0, 4_000),
      holding("AAA", 0, 4_000),
      holding("CCC", 1_000, 2_000),
    ];
    const forward = allocateAdditionalContribution({ ...base, holdings: rows });
    const reversed = allocateAdditionalContribution({
      ...base,
      holdings: [...rows].reverse(),
    });

    assert.equal(forward.status, "ready");
    assert.deepEqual(forward.allocations, reversed.allocations);
    assert.deepEqual(
      forward.allocations.map((row) => [row.ticker, row.allocationKrw]),
      [
        ["AAA", 501],
        ["BBB", 500],
        ["CCC", 0],
      ],
    );
  });

  it("preserves one KRW as residual when every integer increment crosses a cap", () => {
    const result = allocateAdditionalContribution({
      account: "irp",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 1,
      holdings: [holding("AAA", 0, 6_000), holding("BBB", 0, 4_000)],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.totalCappedDeficitKrw, 1);
    assert.equal(result.totalAllocatedKrw, 0);
    assert.equal(result.residualCashKrw, 1);
    assert.equal(result.residualReason, "integer_krw_cap_rounding");
  });

  it("does not block a non-buyable holding that has no post-top-up deficit", () => {
    const result = allocateAdditionalContribution({
      account: "brokerage",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 100,
      holdings: [
        holding("AAA", 900, 5_000, { buyability: "not_buyable" }),
        holding("BBB", 100, 5_000),
      ],
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.allocations.map((row) => [
        row.ticker,
        row.allocationKrw,
        row.allocationStatus,
      ]),
      [
        ["AAA", 0, "not_buyable_no_deficit"],
        ["BBB", 100, "allocated"],
      ],
    );
  });

  it("assigns zero to a target-zero holding", () => {
    const result = allocateAdditionalContribution({
      account: "brokerage",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 100,
      holdings: [holding("AAA", 100, 0), holding("BBB", 0, 10_000)],
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.allocations.map((row) => [
        row.ticker,
        row.allocationKrw,
        row.allocationStatus,
      ]),
      [
        ["AAA", 0, "target_weight_zero"],
        ["BBB", 100, "allocated"],
      ],
    );
  });

  it("blocks a positive deficit that cannot be allocated", () => {
    const result = allocateAdditionalContribution({
      account: "brokerage",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 100,
      holdings: [
        holding(null, 0, 5_000, { buyability: "tickerless" }),
        holding("BBB", 1_000, 5_000),
      ],
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, [
      { reason: "unallocatable_target_deficit", sourceIndex: 0 },
    ]);
    assert.deepEqual(result.allocations, []);
  });

  it("requires an explicit complete target vector and stable unique identity", () => {
    const incomplete = allocateAdditionalContribution({
      account: "brokerage",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 100,
      holdings: [holding("AAA", 100, 9_999)],
    });
    const duplicate = allocateAdditionalContribution({
      account: "brokerage",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 100,
      holdings: [
        holding(" aaa ", 100, 5_000),
        holding("AAA", 100, 5_000),
      ],
    });

    assert.ok(
      incomplete.blockers.some(
        (row) => row.reason === "target_policy_incomplete",
      ),
    );
    assert.ok(
      duplicate.blockers.some((row) => row.reason === "duplicate_instrument"),
    );
  });

  it("fails closed for unsupported accounts and invalid numeric input", () => {
    const cases = [
      { account: "all", cashAmountKrw: 100, holdings: [holding("AAA", 0, 10_000)] },
      { account: "brokerage", cashAmountKrw: 0, holdings: [holding("AAA", 0, 10_000)] },
      { account: "brokerage", cashAmountKrw: 1.5, holdings: [holding("AAA", 0, 10_000)] },
      {
        account: "brokerage",
        cashAmountKrw: 100,
        holdings: [holding("AAA", Number.NaN, 10_000)],
      },
      {
        account: "brokerage",
        cashAmountKrw: 100,
        holdings: [holding("AAA", 0, 9_999.5)],
      },
    ];

    for (const fixture of cases) {
      const result = allocateAdditionalContribution({
        ...fixture,
        targetPolicyVersion: "fixture-v1",
      });
      assert.equal(result.status, "blocked");
      assert.deepEqual(result.allocations, []);
    }

    const invalidPolicy = allocateAdditionalContribution({
      account: "brokerage",
      targetPolicyVersion: "",
      cashAmountKrw: 100,
      holdings: [holding("AAA", 0, 10_000)],
    });
    assert.ok(
      invalidPolicy.blockers.some(
        (row) => row.reason === "invalid_target_policy_version",
      ),
    );
  });

  it("returns only a KRW budget for a USD holding", () => {
    const result = allocateAdditionalContribution({
      account: "brokerage",
      targetPolicyVersion: "fixture-v1",
      cashAmountKrw: 100,
      holdings: [
        holding("VOO", 0, 10_000, {
          market: "us",
          currency: "usd",
        }),
      ],
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(result.allocations[0], {
      instrumentKey: "us:USD:VOO",
      market: "us",
      currency: "USD",
      ticker: "VOO",
      targetWeightBps: 10_000,
      currentValueKrw: 0,
      targetValueAfterTopupKrw: 100,
      cappedDeficitKrw: 100,
      allocationKrw: 100,
      allocationStatus: "allocated",
    });
    assert.doesNotMatch(JSON.stringify(result), /price|quantity|fxRate|provider/i);
  });

  it("preserves conservation and cap invariants across representative fixtures", () => {
    for (let cash = 1; cash <= 50; cash += 1) {
      const result = allocateAdditionalContribution({
        account: "brokerage",
        targetPolicyVersion: "fixture-v1",
        cashAmountKrw: cash,
        holdings: [
          holding("AAA", 3, 5_000),
          holding("BBB", 7, 3_000),
          holding("CCC", 11, 2_000),
        ],
      });
      assert.equal(result.status, "ready");
      assert.equal(result.totalAllocatedKrw + result.residualCashKrw, cash);
      assert.ok(
        result.allocations.every(
          (row) => row.allocationKrw <= row.cappedDeficitKrw + 1e-6,
        ),
      );
      assert.ok(result.totalCappedDeficitKrw + 1e-6 >= cash);
    }
  });

  it("keeps the pure helper free of target inference, providers, DB, and writes", () => {
    const source = [
      "src/lib/additional-contribution-allocator.ts",
      "src/lib/additional-contribution-input.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(source, /\bfetch\s*\(|\/api\/|admin\/jobs/i);
    assert.doesNotMatch(source, /drizzle|neon|database_url|current_price|ma_?120/i);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
    assert.equal(ADDITIONAL_CONTRIBUTION_POLICY.targetInference, "forbidden");
    assert.equal(ADDITIONAL_CONTRIBUTION_POLICY.sells, "forbidden");
  });
});

function holding(ticker, currentValueKrw, targetWeightBps, overrides = {}) {
  return {
    market: "korea",
    currency: "KRW",
    ticker,
    currentValueKrw,
    targetWeightBps,
    buyability: "buyable",
    ...overrides,
  };
}
