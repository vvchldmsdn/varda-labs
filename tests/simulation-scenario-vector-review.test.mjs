import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_SCENARIO_VECTOR_REVIEW_PACKET_POLICY,
  buildSimulationScenarioVectorReviewPacket,
} from "../src/lib/simulation-scenario-vector-review-packet.ts";

describe("Simulation Scenario Vector Review Packet Phase 0", () => {
  it("builds a reviewable but unapproved exact-universe packet", () => {
    const result = buildSimulationScenarioVectorReviewPacket(validInput());

    assert.equal(result.status, "reviewable");
    assert.equal(result.approvalState, "unapproved");
    assert.equal(result.summary.matrixInstrumentCount, 2);
    assert.equal(result.summary.vectorRowCount, 2);
    assert.equal(result.summary.weightTotalBps, 10_000);
    assert.deepEqual(result.canonicalVector, [
      { market: "korea", currency: "KRW", ticker: "069500", weightBps: 6_000 },
      { market: "us", currency: "USD", ticker: "VOO", weightBps: 4_000 },
    ]);
    assert.equal(
      result.scenarioVectorHash,
      "sha256:a1fa2ecb0b83fa756c3446f4e49c1b77433fefa50955d28c2d85495f14e141b8",
    );
  });

  it("is independent of matrix and weight input order", () => {
    const baseline = buildSimulationScenarioVectorReviewPacket(validInput());
    const reordered = buildSimulationScenarioVectorReviewPacket({
      ...validInput(),
      matrixInstruments: [...validInput().matrixInstruments].reverse(),
      weights: [...validInput().weights].reverse(),
    });

    assert.deepEqual(reordered.canonicalVector, baseline.canonicalVector);
    assert.equal(reordered.canonicalSerialization, baseline.canonicalSerialization);
    assert.equal(reordered.scenarioVectorHash, baseline.scenarioVectorHash);
  });

  it("binds scenario identity, version, policy revision, and every weight", () => {
    const baseline = buildSimulationScenarioVectorReviewPacket(validInput());
    const variants = [
      validInput({ scenarioId: "retirement" }),
      validInput({ scenarioVersion: "v2" }),
      validInput({
        weights: [
          weight("069500", 5_999),
          weight("VOO", 4_001, { market: "us", currency: "USD" }),
        ],
      }),
    ];

    for (const input of variants) {
      const result = buildSimulationScenarioVectorReviewPacket(input);
      assert.equal(result.status, "reviewable");
      assert.notEqual(result.scenarioVectorHash, baseline.scenarioVectorHash);
    }
    assert.match(
      baseline.canonicalSerialization,
      /652b9ea9c9b48f51dc4c68e8f148132ca8893d7e/,
    );
  });

  it("rejects missing and external instruments without normalization", () => {
    const missing = buildSimulationScenarioVectorReviewPacket(
      validInput({ weights: [weight("069500", 10_000)] }),
    );
    const external = buildSimulationScenarioVectorReviewPacket(
      validInput({
        weights: [
          ...validInput().weights,
          weight("QQQ", 0, { market: "us", currency: "USD" }),
        ],
      }),
    );

    assertReasons(missing, "missing_instrument_weight");
    assertReasons(external, "external_instrument");
    assert.equal(missing.scenarioVectorHash, null);
    assert.equal(external.scenarioVectorHash, null);
  });

  it("rejects duplicate matrix and weight identities", () => {
    const duplicateMatrix = buildSimulationScenarioVectorReviewPacket(
      validInput({
        matrixInstruments: [
          ...validInput().matrixInstruments,
          instrument("069500"),
        ],
      }),
    );
    const duplicateWeight = buildSimulationScenarioVectorReviewPacket(
      validInput({
        weights: [...validInput().weights, weight("069500", 0)],
      }),
    );

    assertReasons(duplicateMatrix, "duplicate_matrix_identity");
    assertReasons(duplicateWeight, "duplicate_weight_identity");
  });

  it("rejects incomplete identity and unsupported currency", () => {
    const incompleteMatrix = buildSimulationScenarioVectorReviewPacket(
      validInput({
        matrixInstruments: [instrument(null)],
        weights: [],
      }),
    );
    const incompleteWeight = buildSimulationScenarioVectorReviewPacket(
      validInput({ weights: [weight(null, 10_000)] }),
    );
    const unsupported = buildSimulationScenarioVectorReviewPacket({
      scenarioId: "global",
      scenarioVersion: "v1",
      matrixInstruments: [instrument("ABC", { currency: "EUR" })],
      weights: [weight("ABC", 10_000, { currency: "EUR" })],
    });

    assertReasons(incompleteMatrix, "incomplete_matrix_identity");
    assertReasons(incompleteWeight, "incomplete_weight_identity");
    assertReasons(unsupported, "unsupported_matrix_currency");
    assertReasons(unsupported, "unsupported_weight_currency");
  });

  it("rejects invalid scenario metadata", () => {
    const result = buildSimulationScenarioVectorReviewPacket(
      validInput({ scenarioId: " ", scenarioVersion: "bad version" }),
    );

    assertReasons(result, "invalid_scenario_id");
    assertReasons(result, "invalid_scenario_version");
    assert.equal(result.scenarioId, null);
    assert.equal(result.scenarioVersion, null);
  });

  it("rejects non-integer, non-finite, negative, and over-limit weights", () => {
    const invalidWeights = [Number.NaN, 1.5, -1, 10_001];
    for (const invalidWeight of invalidWeights) {
      const result = buildSimulationScenarioVectorReviewPacket(
        validInput({
          weights: [
            weight("069500", invalidWeight),
            weight("VOO", 4_000, { market: "us", currency: "USD" }),
          ],
        }),
      );
      assertReasons(result, "invalid_weight_bps");
      assert.equal(result.scenarioVectorHash, null);
      assert.doesNotMatch(JSON.stringify(result), /NaN|Infinity/);
    }
  });

  it("allows explicit zero weight while requiring an exact total", () => {
    const withZero = buildSimulationScenarioVectorReviewPacket(
      validInput({
        weights: [
          weight("069500", 10_000),
          weight("VOO", 0, { market: "us", currency: "USD" }),
        ],
      }),
    );
    const wrongTotal = buildSimulationScenarioVectorReviewPacket(
      validInput({
        weights: [
          weight("069500", 5_999),
          weight("VOO", 4_000, { market: "us", currency: "USD" }),
        ],
      }),
    );

    assert.equal(withZero.status, "reviewable");
    assert.equal(withZero.summary.zeroWeightCount, 1);
    assertReasons(wrongTotal, "weight_total_invalid");
  });

  it("keeps identical tickers distinct across market and currency", () => {
    const result = buildSimulationScenarioVectorReviewPacket({
      scenarioId: "same-ticker",
      scenarioVersion: "v1",
      matrixInstruments: [
        instrument("SAME"),
        instrument("SAME", { market: "us", currency: "USD" }),
      ],
      weights: [
        weight("SAME", 5_000),
        weight("SAME", 5_000, { market: "us", currency: "USD" }),
      ],
    });

    assert.equal(result.status, "reviewable");
    assert.equal(result.canonicalVector.length, 2);
  });

  it("contains no execution hashes, strategic target inference, I/O, or approval", () => {
    const result = buildSimulationScenarioVectorReviewPacket(validInput());
    const serialized = JSON.stringify(result);
    const source = [
      "src/lib/simulation-scenario-vector-review-input.ts",
      "src/lib/simulation-scenario-vector-review-rules.ts",
      "src/lib/simulation-scenario-vector-review-serialization.ts",
      "src/lib/simulation-scenario-vector-review-packet.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.equal(result.approvalState, "unapproved");
    assert.equal(
      SIMULATION_SCENARIO_VECTOR_REVIEW_PACKET_POLICY.executionHashBinding,
      "forbidden_in_review_packet",
    );
    assert.doesNotMatch(serialized, /inputMatrixHash|drawPlanHash|legacy|owner|user[_-]?id/i);
    assert.doesNotMatch(
      source,
      /isa-v1|targetWeight|currentWeight|equalWeight|inputMatrixHash|drawPlanHash/i,
    );
    assert.doesNotMatch(
      source,
      /@\/db|drizzle|neon|server-only|fetch\s*\(|\/api\/|provider|blob/i,
    );
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
  });
});

function validInput(overrides = {}) {
  return {
    scenarioId: "baseline",
    scenarioVersion: "v1",
    matrixInstruments: [
      instrument("VOO", { market: "us", currency: "USD" }),
      instrument("069500"),
    ],
    weights: [
      weight("069500", 6_000),
      weight("VOO", 4_000, { market: "us", currency: "USD" }),
    ],
    ...overrides,
  };
}

function instrument(ticker, overrides = {}) {
  return {
    market: "korea",
    currency: "KRW",
    ticker,
    ...overrides,
  };
}

function weight(ticker, weightBps, overrides = {}) {
  return {
    market: "korea",
    currency: "KRW",
    ticker,
    weightBps,
    ...overrides,
  };
}

function assertReasons(result, reason) {
  assert.equal(result.status, "invalid");
  assert.ok(
    result.blockers.some((blocker) => blocker.reason === reason),
    JSON.stringify(result.blockers),
  );
}
