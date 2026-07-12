import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_BLOCKER_ORDER,
  SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY,
  summarizeSimulationNormalizedNavDistribution,
} from "../src/lib/simulation-normalized-nav-distribution-summary.ts";
import {
  SYNTHETIC_SUMMARY_DRAW_PLAN_HASH,
  SYNTHETIC_SUMMARY_INPUT_MATRIX_HASH,
  SYNTHETIC_SUMMARY_SCENARIO_VECTOR_HASH,
  syntheticDistributionSummaryInput,
} from "./fixtures/simulation-normalized-nav-distribution-summary.mjs";

describe("Simulation normalized NAV distribution summary Phase 1D0", () => {
  it("calculates pinned Type 7 p10, p50, and p90 bands", () => {
    const result = summarizeSimulationNormalizedNavDistribution(
      syntheticDistributionSummaryInput(),
    );

    assert.equal(result.summaryStatus, "ready");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.scenarioId, "synthetic-distribution");
    assert.equal(
      result.scenarioVectorHash,
      SYNTHETIC_SUMMARY_SCENARIO_VECTOR_HASH,
    );
    assert.equal(result.inputMatrixHash, SYNTHETIC_SUMMARY_INPUT_MATRIX_HASH);
    assert.equal(result.drawPlanHash, SYNTHETIC_SUMMARY_DRAW_PLAN_HASH);
    assert.equal(result.horizon, 2);
    assert.equal(result.pathCount, 5);
    assert.equal(result.totalPointCount, 15);
    assertBand(result.stepBands[0], [0, 1, 1, 1]);
    assertBand(result.stepBands[1], [1, 0.84, 1, 1.16]);
    assertBand(result.stepBands[2], [2, 0.6, 1, 1.4]);
  });

  it("handles one path with identical quantiles", () => {
    const result = summarizeSimulationNormalizedNavDistribution(
      syntheticDistributionSummaryInput({
        pathNavs: [[1, 1.25, 0.75]],
      }),
    );

    assertBand(result.stepBands[1], [1, 1.25, 1.25, 1.25]);
    assertBand(result.stepBands[2], [2, 0.75, 0.75, 0.75]);
  });

  it("pins even-sample Type 7 interpolation", () => {
    const result = summarizeSimulationNormalizedNavDistribution(
      syntheticDistributionSummaryInput({
        pathNavs: [
          [1, 1],
          [1, 2],
          [1, 3],
          [1, 4],
        ],
      }),
    );

    assertBand(result.stepBands[1], [1, 1.3, 2.5, 3.7]);
  });

  it("retains duplicate empirical observations", () => {
    const result = summarizeSimulationNormalizedNavDistribution(
      syntheticDistributionSummaryInput({
        pathNavs: [
          [1, 1],
          [1, 1],
          [1, 2],
          [1, 2],
          [1, 2],
        ],
      }),
    );

    assertBand(result.stepBands[1], [1, 1, 2, 2]);
  });

  it("emits literal-one baseline and exact terminal projection", () => {
    const result = summarizeSimulationNormalizedNavDistribution(
      syntheticDistributionSummaryInput(),
    );

    assert.deepEqual(result.stepBands[0], {
      stepIndex: 0,
      p10: 1,
      p50: 1,
      p90: 1,
    });
    assert.deepEqual(
      result.terminalSummary,
      result.stepBands[result.stepBands.length - 1],
    );
  });

  it("blocks noncanonical path order without sorting or relabeling", () => {
    const outOfOrder = syntheticDistributionSummaryInput();
    outOfOrder.normalizedNav.paths.reverse();
    const mismatchedIndex = syntheticDistributionSummaryInput();
    mismatchedIndex.normalizedNav.paths[1].pathIndex = 9;
    const before = structuredClone(outOfOrder);

    assertBlocked(
      summarizeSimulationNormalizedNavDistribution(outOfOrder),
      ["input_nav_shape_invalid"],
    );
    assertBlocked(
      summarizeSimulationNormalizedNavDistribution(mismatchedIndex),
      ["input_nav_shape_invalid"],
    );
    assert.deepEqual(outOfOrder, before);
  });

  it("is invariant to canonical path assignment for equal per-step multisets", () => {
    const left = syntheticDistributionSummaryInput({
      pathNavs: [
        [1, 0.8, 1.4],
        [1, 1, 1],
        [1, 1.2, 0.6],
      ],
    });
    const right = syntheticDistributionSummaryInput({
      pathNavs: [
        [1, 1.2, 1],
        [1, 0.8, 0.6],
        [1, 1, 1.4],
      ],
    });
    const leftBefore = structuredClone(left);
    const rightBefore = structuredClone(right);

    const leftResult = summarizeSimulationNormalizedNavDistribution(left);
    const rightResult = summarizeSimulationNormalizedNavDistribution(right);

    assert.deepEqual(leftResult.stepBands, rightResult.stepBands);
    assert.deepEqual(left, leftBefore);
    assert.deepEqual(right, rightBefore);
  });

  it("classifies only a top-level runtime trust mismatch", () => {
    const input = syntheticDistributionSummaryInput();
    input.normalizedNav.runtimeTrustStatus = "established";

    assertBlocked(
      summarizeSimulationNormalizedNavDistribution(input),
      ["input_nav_runtime_trust_invalid"],
    );
  });

  it("keeps ready status, input blockers, and policy drift distinct", () => {
    const status = syntheticDistributionSummaryInput();
    status.normalizedNav.calculationStatus = "blocked";
    const blockers = syntheticDistributionSummaryInput();
    blockers.normalizedNav.blockers.push({ reason: "synthetic" });
    const policy = structuredClone(syntheticDistributionSummaryInput());
    policy.normalizedNav.policy.version = "synthetic_wrong_version";

    assertBlocked(summarizeSimulationNormalizedNavDistribution(status), [
      "input_nav_not_ready",
    ]);
    assertBlocked(summarizeSimulationNormalizedNavDistribution(blockers), [
      "input_nav_not_ready",
    ]);
    assertBlocked(summarizeSimulationNormalizedNavDistribution(policy), [
      "input_nav_policy_mismatch",
    ]);
  });

  it("validates the expected binding before comparing three separate hashes", () => {
    const invalidBinding = syntheticDistributionSummaryInput();
    delete invalidBinding.expectedBinding.expectedDrawPlanHash;
    const mismatches = syntheticDistributionSummaryInput();
    mismatches.normalizedNav.scenarioVectorHash = `sha256:${"d".repeat(64)}`;
    mismatches.normalizedNav.inputMatrixHash = `sha256:${"e".repeat(64)}`;
    mismatches.normalizedNav.drawPlanHash = `sha256:${"f".repeat(64)}`;

    assertBlocked(
      summarizeSimulationNormalizedNavDistribution(invalidBinding),
      ["expected_binding_invalid"],
    );
    assertBlocked(summarizeSimulationNormalizedNavDistribution(mismatches), [
      "scenario_vector_hash_mismatch",
      "input_matrix_hash_mismatch",
      "draw_plan_hash_mismatch",
    ]);
  });

  it("rejects malformed step shape, invalid NAV, and baseline drift", () => {
    const stepShape = syntheticDistributionSummaryInput();
    stepShape.normalizedNav.paths[0].points[1].stepIndex = 7;
    const invalidNav = syntheticDistributionSummaryInput();
    invalidNav.normalizedNav.paths[0].points[1].nav = 0;
    const baseline = syntheticDistributionSummaryInput();
    baseline.normalizedNav.paths[0].points[0].nav = 1.01;

    assertBlocked(summarizeSimulationNormalizedNavDistribution(stepShape), [
      "input_nav_shape_invalid",
    ]);
    assertBlocked(summarizeSimulationNormalizedNavDistribution(invalidNav), [
      "invalid_nav",
    ]);
    assertBlocked(summarizeSimulationNormalizedNavDistribution(baseline), [
      "invalid_nav",
    ]);
  });

  it("checks the one-million-point cap before summary allocation", () => {
    const input = syntheticDistributionSummaryInput({ pathNavs: [[1, 1]] });
    input.normalizedNav.horizon = 1_000_000;
    input.normalizedNav.pathCount = 1;
    input.normalizedNav.totalPointCount = 1_000_001;
    input.normalizedNav.totalNavCells = 1_000_001;
    input.normalizedNav.paths = [];

    assert.equal(
      SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_POLICY.maxInputNavPoints,
      1_000_000,
    );
    assertBlocked(summarizeSimulationNormalizedNavDistribution(input), [
      "input_nav_shape_invalid",
      "summary_output_too_large",
    ]);
  });

  it("returns all applicable blockers once in fixed policy order", () => {
    const input = structuredClone(syntheticDistributionSummaryInput());
    input.normalizedNav.calculationStatus = "blocked";
    input.normalizedNav.runtimeTrustStatus = "established";
    input.normalizedNav.policy.version = "synthetic_wrong_version";
    input.normalizedNav.scenarioVectorHash = `sha256:${"d".repeat(64)}`;
    input.normalizedNav.inputMatrixHash = `sha256:${"e".repeat(64)}`;
    input.normalizedNav.drawPlanHash = `sha256:${"f".repeat(64)}`;
    input.normalizedNav.unexpected = "not reflected";
    input.normalizedNav.paths[0].points[1].nav = 0;

    assertBlocked(summarizeSimulationNormalizedNavDistribution(input), [
      "input_nav_not_ready",
      "input_nav_runtime_trust_invalid",
      "input_nav_policy_mismatch",
      "scenario_vector_hash_mismatch",
      "input_matrix_hash_mismatch",
      "draw_plan_hash_mismatch",
      "input_nav_shape_invalid",
      "invalid_nav",
    ]);
  });

  it("uses one exact null-zero projection for every blocked result", () => {
    const input = syntheticDistributionSummaryInput();
    input.normalizedNav.paths[0].points[1].nav = Number.NaN;
    const result = summarizeSimulationNormalizedNavDistribution(input);

    assertBlockedProjection(result);
    assert.deepEqual(Object.keys(result).sort(), [
      "blockers",
      "drawPlanHash",
      "horizon",
      "inputMatrixHash",
      "pathCount",
      "policy",
      "runtimeTrustStatus",
      "scenarioId",
      "scenarioVectorHash",
      "scenarioVersion",
      "stepBands",
      "summaryStatus",
      "terminalSummary",
      "totalPointCount",
    ]);
  });

  it("does not consume point provenance fields", () => {
    const left = syntheticDistributionSummaryInput({
      provenanceVariant: "left",
    });
    const right = syntheticDistributionSummaryInput({
      provenanceVariant: "right",
    });
    for (const path of right.normalizedNav.paths) {
      for (const point of path.points) {
        delete point.drawStepIndex;
        delete point.sourceRowIndex;
        delete point.previousServiceDate;
        delete point.serviceDate;
      }
    }

    assert.deepEqual(
      summarizeSimulationNormalizedNavDistribution(left),
      summarizeSimulationNormalizedNavDistribution(right),
    );
  });

  it("returns minimized deeply immutable summary output", () => {
    const result = summarizeSimulationNormalizedNavDistribution(
      syntheticDistributionSummaryInput(),
    );
    const serialized = JSON.stringify(result);

    assert.deepEqual(Object.keys(result).sort(), [
      "blockers",
      "drawPlanHash",
      "horizon",
      "inputMatrixHash",
      "pathCount",
      "policy",
      "runtimeTrustStatus",
      "scenarioId",
      "scenarioVectorHash",
      "scenarioVersion",
      "stepBands",
      "summaryStatus",
      "terminalSummary",
      "totalPointCount",
    ]);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.policy), true);
    assert.equal(Object.isFrozen(result.policy.quantileProbabilities), true);
    assert.equal(Object.isFrozen(result.stepBands), true);
    assert.equal(Object.isFrozen(result.stepBands[0]), true);
    assert.equal(Object.isFrozen(result.terminalSummary), true);
    assert.equal(Object.isFrozen(result.blockers), true);
    assert.doesNotMatch(
      serialized,
      /"paths"|drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate|canonicalVector|weightBps|owner|user[_-]?id|approval/i,
    );
  });

  it("keeps the implementation pure and outside runtime execution", () => {
    const sourcePaths = [
      "src/lib/simulation-normalized-nav-distribution-summary-policy.ts",
      "src/lib/simulation-normalized-nav-distribution-summary-types.ts",
      "src/lib/simulation-normalized-nav-distribution-summary-validation.ts",
      "src/lib/simulation-normalized-nav-distribution-summary.ts",
    ];
    const source = sourcePaths
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.deepEqual(
      [...SIMULATION_NORMALIZED_NAV_DISTRIBUTION_SUMMARY_BLOCKER_ORDER],
      [
        "input_nav_not_ready",
        "input_nav_runtime_trust_invalid",
        "input_nav_policy_mismatch",
        "expected_binding_invalid",
        "scenario_vector_hash_mismatch",
        "input_matrix_hash_mismatch",
        "draw_plan_hash_mismatch",
        "input_nav_shape_invalid",
        "summary_output_too_large",
        "invalid_nav",
        "invalid_quantile",
      ],
    );
    assert.doesNotMatch(
      source,
      /drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate|@\/db|drizzle|neon|DATABASE_URL|process\.env|node:fs|\bfetch\s*\(|Math\.random|next\/|initialKrw|optimizer/i,
    );
  });
});

function assertBand(band, [stepIndex, p10, p50, p90]) {
  assert.equal(band.stepIndex, stepIndex);
  assertClose(band.p10, p10);
  assertClose(band.p50, p50);
  assertClose(band.p90, p90);
}

function assertClose(actual, expected) {
  assert.ok(
    Math.abs(actual - expected) <= Number.EPSILON * 16,
    `${actual} !== ${expected}`,
  );
}

function assertBlocked(result, reasons) {
  assertBlockedProjection(result);
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.reason),
    reasons,
  );
  assert.equal(new Set(reasons).size, reasons.length);
  assert.equal(Object.isFrozen(result.blockers), true);
  result.blockers.forEach((blocker) => {
    assert.deepEqual(Object.keys(blocker), ["reason"]);
    assert.equal(Object.isFrozen(blocker), true);
  });
}

function assertBlockedProjection(result) {
  assert.equal(result.summaryStatus, "blocked");
  assert.equal(result.runtimeTrustStatus, "not_established");
  assert.equal(result.scenarioId, null);
  assert.equal(result.scenarioVersion, null);
  assert.equal(result.scenarioVectorHash, null);
  assert.equal(result.inputMatrixHash, null);
  assert.equal(result.drawPlanHash, null);
  assert.equal(result.horizon, 0);
  assert.equal(result.pathCount, 0);
  assert.equal(result.totalPointCount, 0);
  assert.deepEqual(result.stepBands, []);
  assert.equal(result.terminalSummary, null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.stepBands), true);
}
