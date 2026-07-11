import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  TARGET_POLICY_REVIEW_PACKET_POLICY,
  buildTargetPolicyReviewPacket,
} from "../src/lib/target-policy-review-packet.ts";

describe("target policy Gate B0 review packet", () => {
  it("builds an unapproved review packet from explicit integer weights", () => {
    const result = buildTargetPolicyReviewPacket(validInput());

    assert.equal(result.status, "reviewable");
    assert.equal(result.approvalState, "unapproved");
    assert.equal(
      result.policy.universeAuthority,
      "caller_supplied_unverified",
    );
    assert.equal(
      result.policy.productionApproval,
      "forbidden_without_reviewed_universe",
    );
    assert.equal(result.summary.targetTotalBps, 10_000);
    assert.equal(result.summary.vectorRowCount, 2);
    assert.deepEqual(result.canonicalVector, [
      {
        market: "korea",
        currency: "KRW",
        ticker: "AAA",
        targetWeightBps: 6_000,
      },
      {
        market: "us",
        currency: "USD",
        ticker: "BBB",
        targetWeightBps: 4_000,
      },
    ]);
    assert.match(result.vectorHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(
      result.vectorHash,
      "sha256:c6a2147b78dc24d127bb5e653b1ae933d5712d8ea8cbf37a321a9250aeb34e6b",
    );
    assert.deepEqual(result.blockers, []);

    const serialized = JSON.parse(result.canonicalSerialization);
    assert.deepEqual(Object.keys(serialized), [
      "policyId",
      "policyVersion",
      "account",
      "effectiveServiceDate",
      "vector",
    ]);
    assert.equal(
      serialized.policyId,
      "account_scoped_explicit_instrument_targets_v1",
    );
  });

  it("produces identical packets and hashes regardless of input order", () => {
    const forwardInput = validInput();
    const reverseInput = validInput({
      currentHoldings: [...forwardInput.currentHoldings].reverse(),
      decisions: [...forwardInput.decisions].reverse(),
    });

    const forward = buildTargetPolicyReviewPacket(forwardInput);
    const reverse = buildTargetPolicyReviewPacket(reverseInput);

    assert.deepEqual(forward, reverse);
  });

  it("changes the hash when version, account, date, or any weight changes", () => {
    const baseline = buildTargetPolicyReviewPacket(validInput());
    const changed = [
      validInput({ policyVersion: "brokerage-v2" }),
      validInput({ account: "isa" }),
      validInput({ effectiveServiceDate: "2026-07-12" }),
      validInput({
        decisions: [
          decision("AAA", 5_000),
          decision("BBB", 5_000, { market: "us", currency: "USD" }),
        ],
      }),
    ].map(buildTargetPolicyReviewPacket);

    assert.ok(changed.every((row) => row.status === "reviewable"));
    assert.ok(changed.every((row) => row.vectorHash !== baseline.vectorHash));
  });

  it("does not silently treat a missing holding decision as zero", () => {
    const result = buildTargetPolicyReviewPacket(
      validInput({ decisions: [decision("AAA", 10_000)] }),
    );

    assert.equal(result.status, "invalid");
    assert.equal(result.vectorHash, null);
    assert.ok(hasReason(result, "missing_holding_decision"));
  });

  it("rejects decisions for instruments outside the current universe", () => {
    const input = validInput();
    const result = buildTargetPolicyReviewPacket({
      ...input,
      decisions: [...input.decisions, decision("CCC", 0)],
    });

    assert.equal(result.status, "invalid");
    assert.ok(hasReason(result, "external_instrument"));
    assert.equal(result.canonicalVector, null);
  });

  it("rejects duplicate current and decision identities", () => {
    const input = validInput();
    const duplicateHolding = buildTargetPolicyReviewPacket({
      ...input,
      currentHoldings: [...input.currentHoldings, holding("AAA")],
    });
    const duplicateDecision = buildTargetPolicyReviewPacket({
      ...input,
      decisions: [...input.decisions, decision("AAA", 0)],
    });

    assert.ok(hasReason(duplicateHolding, "duplicate_holding_identity"));
    assert.ok(hasReason(duplicateDecision, "duplicate_decision_identity"));
    assert.equal(duplicateHolding.vectorHash, null);
    assert.equal(duplicateDecision.vectorHash, null);
  });

  it("blocks a positive target for a non-buyable holding", () => {
    const input = validInput();
    const result = buildTargetPolicyReviewPacket({
      ...input,
      currentHoldings: [
        holding("AAA", { buyability: "not_buyable" }),
        input.currentHoldings[1],
      ],
    });

    assert.equal(result.status, "invalid");
    assert.ok(hasReason(result, "positive_target_not_buyable"));
    assert.equal(result.vectorHash, null);
  });

  it("allows explicit zero or exclusion without manufacturing a weight", () => {
    const zeroTarget = buildTargetPolicyReviewPacket({
      ...validInput(),
      currentHoldings: [
        holding("AAA", { buyability: "not_buyable" }),
        holding("BBB", { market: "us", currency: "USD" }),
      ],
      decisions: [
        decision("AAA", 0, { decision: "zero_target" }),
        decision("BBB", 10_000, { market: "us", currency: "USD" }),
      ],
    });
    const excluded = buildTargetPolicyReviewPacket({
      ...validInput(),
      currentHoldings: [
        holding("AAA", { buyability: "not_buyable" }),
        holding("BBB", { market: "us", currency: "USD" }),
      ],
      decisions: [
        decision("AAA", null, {
          decision: "excluded",
          exclusionReason: "outside_v1_topup_universe",
        }),
        decision("BBB", 10_000, { market: "us", currency: "USD" }),
      ],
    });

    assert.equal(zeroTarget.status, "reviewable");
    assert.equal(zeroTarget.summary.zeroTargetCount, 1);
    assert.equal(excluded.status, "reviewable");
    assert.equal(excluded.summary.excludedCount, 1);
    assert.equal(excluded.canonicalVector.length, 1);
    assert.equal(excluded.canonicalVector[0].targetWeightBps, 10_000);
  });

  it("requires explicit exclusion semantics and exact target totals", () => {
    const missingReason = buildTargetPolicyReviewPacket({
      ...validInput(),
      decisions: [
        decision("AAA", null, { decision: "excluded" }),
        decision("BBB", 10_000, { market: "us", currency: "USD" }),
      ],
    });
    const wrongTotal = buildTargetPolicyReviewPacket(
      validInput({
        decisions: [
          decision("AAA", 5_999),
          decision("BBB", 4_000, { market: "us", currency: "USD" }),
        ],
      }),
    );

    assert.ok(hasReason(missingReason, "missing_exclusion_reason"));
    assert.ok(hasReason(wrongTotal, "target_total_invalid"));
    assert.equal(missingReason.vectorHash, null);
    assert.equal(wrongTotal.vectorHash, null);
  });

  it("rejects non-integer, non-finite, and disposition-mismatched weights", () => {
    const cases = [
      decision("AAA", 6_000.5),
      decision("AAA", Number.NaN),
      decision("AAA", 1, { decision: "zero_target" }),
      decision("AAA", 0, {
        decision: "excluded",
        exclusionReason: "outside_v1_topup_universe",
      }),
    ];

    for (const row of cases) {
      const result = buildTargetPolicyReviewPacket(
        validInput({
          decisions: [
            row,
            decision("BBB", 4_000, { market: "us", currency: "USD" }),
          ],
        }),
      );
      assert.equal(result.status, "invalid");
      assert.equal(result.vectorHash, null);
      assert.ok(
        result.rows.every(
          (reviewRow) =>
            reviewRow.targetWeightBps === null ||
            Number.isFinite(reviewRow.targetWeightBps),
        ),
      );
    }
  });

  it("keeps same tickers distinct across market and currency", () => {
    const result = buildTargetPolicyReviewPacket({
      account: "irp",
      policyVersion: "irp-v1",
      effectiveServiceDate: "2026-07-11",
      currentHoldings: [
        holding("SAME"),
        holding("SAME", { market: "us", currency: "USD", name: "Same US" }),
      ],
      decisions: [
        decision("SAME", 5_000),
        decision("SAME", 5_000, { market: "us", currency: "USD" }),
      ],
    });

    assert.equal(result.status, "reviewable");
    assert.equal(result.canonicalVector.length, 2);
  });

  it("fails closed for invalid metadata and incomplete holding identity", () => {
    const invalidMetadata = buildTargetPolicyReviewPacket(
      validInput({
        account: "all",
        policyVersion: "",
        effectiveServiceDate: "2026-02-30",
      }),
    );
    const tickerless = buildTargetPolicyReviewPacket({
      ...validInput(),
      currentHoldings: [holding(null, { buyability: "tickerless" })],
      decisions: [],
    });

    assert.ok(hasReason(invalidMetadata, "invalid_account"));
    assert.ok(hasReason(invalidMetadata, "invalid_policy_version"));
    assert.ok(hasReason(invalidMetadata, "invalid_effective_service_date"));
    assert.ok(hasReason(tickerless, "incomplete_holding_identity"));
    assert.equal(invalidMetadata.vectorHash, null);
    assert.equal(tickerless.vectorHash, null);
  });

  it("keeps packet output and implementation free of internal evidence and I/O", () => {
    const result = buildTargetPolicyReviewPacket(validInput());
    const serialized = JSON.stringify(result);
    const source = [
      "src/lib/target-policy-review-input.ts",
      "src/lib/target-policy-review-rules.ts",
      "src/lib/target-policy-review-serialization.ts",
      "src/lib/target-policy-review-packet.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(serialized, /\b[0-9a-f]{24}\b/i);
    assert.doesNotMatch(
      serialized,
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
    assert.doesNotMatch(
      serialized,
      /legacy|owner|provider|price|quantity|authorization|api[_-]?key|secret|token/i,
    );
    assert.doesNotMatch(source, /\bfetch\s*\(|\/api\/|admin\/jobs/i);
    assert.doesNotMatch(
      source,
      /drizzle|neon|database_url|assets\.target_weight|asset_groups|asset_group_members|current_price/i,
    );
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
    assert.equal(TARGET_POLICY_REVIEW_PACKET_POLICY.rawTargetInference, "forbidden");
    assert.equal(TARGET_POLICY_REVIEW_PACKET_POLICY.persistence, "forbidden");
  });
});

function hasReason(result, reason) {
  return result.blockers.some((row) => row.reason === reason);
}

function validInput(overrides = {}) {
  return {
    account: "brokerage",
    policyVersion: "brokerage-v1",
    effectiveServiceDate: "2026-07-11",
    currentHoldings: [
      holding("AAA"),
      holding("BBB", { market: "us", currency: "USD" }),
    ],
    decisions: [
      decision("AAA", 6_000),
      decision("BBB", 4_000, { market: "us", currency: "USD" }),
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
    buyability: "buyable",
    ...overrides,
  };
}

function decision(ticker, targetWeightBps, overrides = {}) {
  return {
    market: "korea",
    currency: "KRW",
    ticker,
    decision: targetWeightBps === 0 ? "zero_target" : "positive_target",
    targetWeightBps,
    exclusionReason: null,
    ...overrides,
  };
}
