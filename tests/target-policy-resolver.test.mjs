import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TARGET_POLICY_RESOLVER_POLICY,
  resolveApprovedTargetPolicy,
} from "../src/lib/target-policy-resolver.ts";

describe("target policy resolver Phase 1A", () => {
  it("resolves the approved ISA vector from matching B0 and B1 evidence", () => {
    const result = resolveApprovedTargetPolicy(validInput());

    assert.equal(result.status, "ready");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.account, "isa");
    assert.equal(result.policyVersion, "isa-v1");
    assert.equal(result.effectiveServiceDate, "2026-07-11");
    assert.deepEqual(result.evidence, {
      universeHash:
        "sha256:3dfed5a3d43ae4531227b5b75fabb295c2575f7959261b530e05fdde14596c66",
      vectorHash:
        "sha256:85e6181e6e5f54ca9d1eda2cc8940c6cd576970a5f5136fdc6920227f200f2ca",
    });
    assert.deepEqual(result.targetVector, [
      resolvedRow("133690", 3_500),
      resolvedRow("360200", 3_500),
      resolvedRow("475350", 1_000),
      resolvedRow("489250", 2_000),
    ]);
  });

  it("is independent of approved vector and universe input order", () => {
    const input = validInput();
    const reversed = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: {
        ...input.approvedPolicy,
        vector: [...input.approvedPolicy.vector].reverse(),
      },
      currentUniverse: {
        ...input.currentUniverse,
        holdings: [...input.currentUniverse.holdings].reverse(),
      },
    });

    assert.deepEqual(reversed, resolveApprovedTargetPolicy(input));
  });

  it("requires an explicit approved state and the exact policy id", () => {
    const input = validInput();
    const unapproved = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: { ...input.approvedPolicy, approvalState: "unapproved" },
    });
    const wrongPolicy = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: { ...input.approvedPolicy, policyId: "other_policy" },
    });

    assertBlocked(unapproved, "target_policy_approval_missing");
    assertBlocked(wrongPolicy, "target_policy_policy_id_mismatch");
  });

  it("fails closed when the current universe changes", () => {
    const input = validInput();
    const variants = [
      input.currentUniverse.holdings.slice(0, -1),
      [...input.currentUniverse.holdings, holding("005930", "Samsung")],
      input.currentUniverse.holdings.map((row, index) =>
        index === 0 ? { ...row, ticker: "133691" } : row,
      ),
      input.currentUniverse.holdings.map((row, index) =>
        index === 0 ? { ...row, currency: "USD" } : row,
      ),
    ];

    for (const holdings of variants) {
      const result = resolveApprovedTargetPolicy({
        ...input,
        currentUniverse: { account: "isa", holdings },
      });
      assertBlocked(result, "target_policy_universe_mismatch");
    }
  });

  it("blocks vector, vector-hash, missing-row, and duplicate-row drift", () => {
    const input = validInput();
    const changedWeights = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: {
        ...input.approvedPolicy,
        vector: [
          vectorRow("133690", 3_400),
          vectorRow("360200", 3_600),
          vectorRow("475350", 1_000),
          vectorRow("489250", 2_000),
        ],
      },
    });
    const changedHash = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: {
        ...input.approvedPolicy,
        vectorHash: `sha256:${"0".repeat(64)}`,
      },
    });
    const missingRow = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: {
        ...input.approvedPolicy,
        vector: input.approvedPolicy.vector.slice(0, -1),
      },
    });
    const duplicateRow = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: {
        ...input.approvedPolicy,
        vector: [
          ...input.approvedPolicy.vector,
          vectorRow("133690", 0),
        ],
      },
    });

    for (const result of [changedWeights, changedHash, missingRow, duplicateRow]) {
      assertBlocked(result, "target_policy_vector_mismatch");
    }
  });

  it("blocks invalid totals instead of normalizing them", () => {
    const input = validInput();
    const result = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: {
        ...input.approvedPolicy,
        vector: input.approvedPolicy.vector.map((row, index) =>
          index === 0 ? { ...row, targetWeightBps: 3_499 } : row,
        ),
      },
    });

    assertBlocked(result, "target_policy_total_invalid");
    assert.equal(result.targetVector, null);
  });

  it("binds request account and version to the approved policy", () => {
    const input = validInput();
    const wrongVersion = resolveApprovedTargetPolicy({
      ...input,
      request: { ...input.request, policyVersion: "isa-v2" },
    });
    const allAccount = resolveApprovedTargetPolicy({
      ...input,
      request: { ...input.request, account: "all" },
    });
    const universeAccount = resolveApprovedTargetPolicy({
      ...input,
      currentUniverse: { ...input.currentUniverse, account: "brokerage" },
    });

    assertBlocked(wrongVersion, "target_policy_version_unavailable");
    assertBlocked(allAccount, "target_policy_account_invalid");
    assertBlocked(universeAccount, "target_policy_universe_mismatch");
  });

  it("enforces the effective service date without falling back", () => {
    const input = validInput();
    const beforeEffective = resolveApprovedTargetPolicy({
      ...input,
      request: { ...input.request, serviceDate: "2026-07-10" },
    });
    const invalidServiceDate = resolveApprovedTargetPolicy({
      ...input,
      request: { ...input.request, serviceDate: "2026-02-30" },
    });
    const tamperedEffectiveDate = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: {
        ...input.approvedPolicy,
        effectiveServiceDate: "2026-07-10",
      },
    });

    assertBlocked(beforeEffective, "target_policy_not_effective");
    assertBlocked(invalidServiceDate, "target_policy_service_date_invalid");
    assertBlocked(tamperedEffectiveDate, "target_policy_vector_mismatch");
  });

  it("returns no vector or evidence when blocked", () => {
    const input = validInput();
    const result = resolveApprovedTargetPolicy({
      ...input,
      approvedPolicy: { ...input.approvedPolicy, approvalState: "unapproved" },
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.targetVector, null);
    assert.equal(result.evidence, null);
  });

  it("keeps the resolver pure and outside runtime trust and allocation", () => {
    const source = readFileSync("src/lib/target-policy-resolver.ts", "utf8");
    const result = resolveApprovedTargetPolicy(validInput());

    assert.equal(
      TARGET_POLICY_RESOLVER_POLICY.approvalAuthenticity,
      "trusted_adapter_required_outside_phase1a",
    );
    assert.equal(TARGET_POLICY_RESOLVER_POLICY.persistence, "forbidden");
    assert.equal(TARGET_POLICY_RESOLVER_POLICY.allocatorConnection, "forbidden");
    assert.match(source, /buildTargetPolicyHoldingUniverse/);
    assert.match(source, /buildTargetPolicyReviewPacket/);
    assert.doesNotMatch(
      source,
      /server-only|@\/db|drizzle|neon|node:fs|readFile|docs\//i,
    );
    assert.doesNotMatch(
      source,
      /from\s+["'][^"']*(?:additional-contribution|allocator|provider|route)[^"']*["']|fetch\s*\(|\/api\//i,
    );
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /legacy|owner|provider|price|quantity|authorization|api[_-]?key|secret|token/i,
    );
  });
});

function validInput() {
  return {
    request: {
      account: "isa",
      policyVersion: "isa-v1",
      serviceDate: "2026-07-11",
    },
    approvedPolicy: {
      approvalState: "approved",
      policyId: "account_scoped_explicit_instrument_targets_v1",
      account: "isa",
      policyVersion: "isa-v1",
      effectiveServiceDate: "2026-07-11",
      universeHash:
        "sha256:3dfed5a3d43ae4531227b5b75fabb295c2575f7959261b530e05fdde14596c66",
      vectorHash:
        "sha256:85e6181e6e5f54ca9d1eda2cc8940c6cd576970a5f5136fdc6920227f200f2ca",
      vector: [
        vectorRow("133690", 3_500),
        vectorRow("360200", 3_500),
        vectorRow("475350", 1_000),
        vectorRow("489250", 2_000),
      ],
    },
    currentUniverse: {
      account: "isa",
      holdings: [
        holding("133690", "TIGER US Nasdaq 100"),
        holding("360200", "ACE US S&P 500"),
        holding("475350", "RISE Berkshire Portfolio Top 10"),
        holding("489250", "KODEX US Dividend Dow Jones"),
      ],
    },
  };
}

function vectorRow(ticker, targetWeightBps) {
  return { market: "korea", currency: "KRW", ticker, targetWeightBps };
}

function holding(ticker, name) {
  return { name, market: "korea", currency: "KRW", ticker };
}

function resolvedRow(ticker, targetWeightBps) {
  return {
    instrumentKey: `korea:KRW:${ticker}`,
    market: "korea",
    currency: "KRW",
    ticker,
    targetWeightBps,
    buyability: "buyable",
  };
}

function assertBlocked(result, reason) {
  assert.equal(result.status, "blocked");
  assert.equal(result.targetVector, null);
  assert.ok(result.blockers.includes(reason), JSON.stringify(result.blockers));
}
