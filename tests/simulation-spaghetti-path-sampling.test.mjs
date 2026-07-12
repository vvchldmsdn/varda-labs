import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_SPAGHETTI_PATH_SAMPLE_BLOCKER_ORDER,
  SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY,
  sampleSimulationSpaghettiPaths,
} from "../src/lib/simulation-spaghetti-path-sampling.ts";
import {
  SYNTHETIC_SPAGHETTI_DRAW_PLAN_HASH,
  SYNTHETIC_SPAGHETTI_INPUT_MATRIX_HASH,
  SYNTHETIC_SPAGHETTI_SCENARIO_VECTOR_HASH,
  syntheticSpaghettiPathNavs,
  syntheticSpaghettiPathSampleInput,
} from "./fixtures/simulation-spaghetti-path-sampling.mjs";

describe("Simulation deterministic spaghetti path sampling Phase 1E0", () => {
  it("selects the pinned evenly spaced canonical path subset", () => {
    const result = sampleSimulationSpaghettiPaths(
      syntheticSpaghettiPathSampleInput(),
    );

    assert.equal(result.sampleStatus, "ready");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.scenarioId, "synthetic-spaghetti");
    assert.equal(
      result.scenarioVectorHash,
      SYNTHETIC_SPAGHETTI_SCENARIO_VECTOR_HASH,
    );
    assert.equal(result.inputMatrixHash, SYNTHETIC_SPAGHETTI_INPUT_MATRIX_HASH);
    assert.equal(result.drawPlanHash, SYNTHETIC_SPAGHETTI_DRAW_PLAN_HASH);
    assert.equal(result.horizon, 3);
    assert.equal(result.inputPathCount, 6);
    assert.equal(result.selectedPathCount, 3);
    assert.equal(result.totalInputPointCount, 24);
    assert.equal(result.totalOutputPointCount, 12);
    assert.deepEqual(selectedIndices(result), [0, 2, 5]);
    assert.deepEqual(
      result.selectedPaths[1].points.map((point) => point.nav),
      [1, 1, 1.1, 1.2],
    );
  });

  it("uses the lower-middle path for one explicit sample", () => {
    const odd = sampleSimulationSpaghettiPaths(
      syntheticSpaghettiPathSampleInput({
        pathNavs: syntheticSpaghettiPathNavs(5, 3),
        sampleCount: 1,
      }),
    );
    const even = sampleSimulationSpaghettiPaths(
      syntheticSpaghettiPathSampleInput({ sampleCount: 1 }),
    );

    assert.deepEqual(selectedIndices(odd), [2]);
    assert.deepEqual(selectedIndices(even), [2]);
  });

  it("includes endpoints with pinned uneven spacing for multiple samples", () => {
    const result = sampleSimulationSpaghettiPaths(
      syntheticSpaghettiPathSampleInput({ sampleCount: 4 }),
    );

    assert.deepEqual(selectedIndices(result), [0, 1, 3, 5]);
    assert.equal(result.selectedPaths[0].pathIndex, 0);
    assert.equal(result.selectedPaths.at(-1).pathIndex, 5);
  });

  it("keeps selections ascending and unique across bounded path/count pairs", () => {
    for (let pathCount = 1; pathCount <= 80; pathCount += 1) {
      for (
        let sampleCount = 1;
        sampleCount <= Math.min(pathCount, 64);
        sampleCount += 1
      ) {
        const result = sampleSimulationSpaghettiPaths(
          syntheticSpaghettiPathSampleInput({
            pathNavs: syntheticSpaghettiPathNavs(pathCount, 2),
            sampleCount,
          }),
        );
        const indices = selectedIndices(result);

        assert.equal(indices.length, sampleCount);
        assert.equal(new Set(indices).size, sampleCount);
        assert.equal(
          indices.every((value, index) => index === 0 || value > indices[index - 1]),
          true,
        );
        if (sampleCount > 1) {
          assert.equal(indices[0], 0);
          assert.equal(indices.at(-1), pathCount - 1);
        }
      }
    }
  });

  it("selects every path exactly once when sample count equals path count", () => {
    const result = sampleSimulationSpaghettiPaths(
      syntheticSpaghettiPathSampleInput({ sampleCount: 6 }),
    );

    assert.deepEqual(selectedIndices(result), [0, 1, 2, 3, 4, 5]);
    assert.equal(result.totalInputPointCount, result.totalOutputPointCount);
    result.selectedPaths.forEach((path) => {
      assert.equal(path.points.length, result.horizon + 1);
    });
  });

  it("is deterministic and does not mutate canonical input", () => {
    const input = syntheticSpaghettiPathSampleInput({ sampleCount: 4 });
    const before = structuredClone(input);

    const left = sampleSimulationSpaghettiPaths(input);
    const right = sampleSimulationSpaghettiPaths(input);

    assert.deepEqual(left, right);
    assert.deepEqual(input, before);
  });

  it("blocks the whole result for an invalid unselected path", () => {
    const invalidNav = syntheticSpaghettiPathSampleInput({ sampleCount: 2 });
    invalidNav.normalizedNav.paths[3].points[2].nav = 0;
    const invalidShape = syntheticSpaghettiPathSampleInput({ sampleCount: 2 });
    invalidShape.normalizedNav.paths[3].points[2].stepIndex = 9;

    assertBlocked(sampleSimulationSpaghettiPaths(invalidNav), ["invalid_nav"]);
    assertBlocked(sampleSimulationSpaghettiPaths(invalidShape), [
      "input_nav_shape_invalid",
    ]);
  });

  it("rejects every non-positive, fractional, non-finite, or unsafe count", () => {
    for (const sampleCount of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      null,
    ]) {
      assertBlocked(
        sampleSimulationSpaghettiPaths(
          syntheticSpaghettiPathSampleInput({ sampleCount }),
        ),
        ["sample_count_invalid"],
      );
    }
  });

  it("keeps path-count and policy-count limits distinct", () => {
    const overPathCount = syntheticSpaghettiPathSampleInput({ sampleCount: 7 });
    const overPolicyCount = syntheticSpaghettiPathSampleInput({
      pathNavs: syntheticSpaghettiPathNavs(65, 2),
      sampleCount: 65,
    });
    const overBoth = syntheticSpaghettiPathSampleInput({ sampleCount: 65 });

    assertBlocked(sampleSimulationSpaghettiPaths(overPathCount), [
      "sample_count_exceeds_path_count",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(overPolicyCount), [
      "sample_count_exceeds_limit",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(overBoth), [
      "sample_count_exceeds_path_count",
      "sample_count_exceeds_limit",
    ]);
  });

  it("accepts the exact output cap and blocks one complete step over it", () => {
    const atCap = sampleSimulationSpaghettiPaths(
      syntheticSpaghettiPathSampleInput({
        pathNavs: syntheticSpaghettiPathNavs(64, 256),
        sampleCount: 64,
      }),
    );
    const overCap = sampleSimulationSpaghettiPaths(
      syntheticSpaghettiPathSampleInput({
        pathNavs: syntheticSpaghettiPathNavs(64, 257),
        sampleCount: 64,
      }),
    );

    assert.equal(atCap.sampleStatus, "ready");
    assert.equal(atCap.totalOutputPointCount, 16_384);
    assertBlocked(overCap, ["sample_output_too_large"]);
  });

  it("keeps the input cap inclusive and blocks a safely calculated overage", () => {
    const atCap = syntheticCapSizedSpaghettiPathSampleInput({
      pathCount: 64,
      pointCount: 15_625,
      sampleCount: 1,
    });
    const overCap = syntheticCapSizedSpaghettiPathSampleInput({
      pathCount: 65,
      pointCount: 15_385,
      sampleCount: 1,
    });

    assert.equal(
      SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY.maxInputNavPoints,
      1_000_000,
    );
    const validCap = sampleSimulationSpaghettiPaths(atCap);
    assert.equal(validCap.sampleStatus, "ready");
    assert.equal(validCap.inputPathCount, 64);
    assert.equal(validCap.horizon, 15_624);
    assert.equal(validCap.totalInputPointCount, 1_000_000);
    assert.equal(validCap.totalOutputPointCount, 15_625);
    assert.deepEqual(selectedIndices(validCap), [31]);
    assertBlocked(sampleSimulationSpaghettiPaths(overCap), [
      "input_nav_too_large",
    ]);
  });

  it("keeps status, trust, policy, binding, and hash failures distinct", () => {
    const status = syntheticSpaghettiPathSampleInput();
    status.normalizedNav.calculationStatus = "blocked";
    const trust = syntheticSpaghettiPathSampleInput();
    trust.normalizedNav.runtimeTrustStatus = "established";
    const policy = structuredClone(syntheticSpaghettiPathSampleInput());
    policy.normalizedNav.policy.version = "synthetic_wrong_version";
    const binding = syntheticSpaghettiPathSampleInput();
    delete binding.expectedBinding.expectedDrawPlanHash;
    const hashes = syntheticSpaghettiPathSampleInput();
    hashes.normalizedNav.scenarioVectorHash = `sha256:${"d".repeat(64)}`;
    hashes.normalizedNav.inputMatrixHash = `sha256:${"e".repeat(64)}`;
    hashes.normalizedNav.drawPlanHash = `sha256:${"f".repeat(64)}`;

    assertBlocked(sampleSimulationSpaghettiPaths(status), [
      "input_nav_not_ready",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(trust), [
      "input_nav_runtime_trust_invalid",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(policy), [
      "input_nav_policy_mismatch",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(binding), [
      "expected_binding_invalid",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(hashes), [
      "scenario_vector_hash_mismatch",
      "input_matrix_hash_mismatch",
      "draw_plan_hash_mismatch",
    ]);
  });

  it("does not fabricate semantic blockers before top-level shape exists", () => {
    const missing = syntheticSpaghettiPathSampleInput({ sampleCount: 0 });
    missing.normalizedNav = null;
    delete missing.expectedBinding.expectedDrawPlanHash;
    const missingKey = syntheticSpaghettiPathSampleInput();
    delete missingKey.normalizedNav.runtimeTrustStatus;

    assertBlocked(sampleSimulationSpaghettiPaths(missing), [
      "input_nav_not_ready",
      "expected_binding_invalid",
      "input_nav_shape_invalid",
      "sample_count_invalid",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(missingKey), [
      "input_nav_not_ready",
      "input_nav_shape_invalid",
    ]);
  });

  it("rejects path order, step order, invalid NAV, and baseline drift", () => {
    const pathOrder = syntheticSpaghettiPathSampleInput();
    pathOrder.normalizedNav.paths.reverse();
    const stepOrder = syntheticSpaghettiPathSampleInput();
    stepOrder.normalizedNav.paths[0].points[1].stepIndex = 7;
    const invalidNav = syntheticSpaghettiPathSampleInput();
    invalidNav.normalizedNav.paths[0].points[1].nav = Number.NaN;
    const baseline = syntheticSpaghettiPathSampleInput();
    baseline.normalizedNav.paths[0].points[0].nav = 1.01;

    assertBlocked(sampleSimulationSpaghettiPaths(pathOrder), [
      "input_nav_shape_invalid",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(stepOrder), [
      "input_nav_shape_invalid",
    ]);
    assertBlocked(sampleSimulationSpaghettiPaths(invalidNav), ["invalid_nav"]);
    assertBlocked(sampleSimulationSpaghettiPaths(baseline), ["invalid_nav"]);
  });

  it("returns every applicable blocker once in fixed policy order", () => {
    const input = structuredClone(syntheticSpaghettiPathSampleInput());
    input.normalizedNav.calculationStatus = "blocked";
    input.normalizedNav.runtimeTrustStatus = "established";
    input.normalizedNav.policy.version = "synthetic_wrong_version";
    input.normalizedNav.scenarioVectorHash = `sha256:${"d".repeat(64)}`;
    input.normalizedNav.inputMatrixHash = `sha256:${"e".repeat(64)}`;
    input.normalizedNav.drawPlanHash = `sha256:${"f".repeat(64)}`;
    input.normalizedNav.unexpected = "not reflected";
    input.normalizedNav.paths[0].points[1].nav = 0;
    input.sampleCount = 5_000;

    assertBlocked(sampleSimulationSpaghettiPaths(input), [
      "input_nav_not_ready",
      "input_nav_runtime_trust_invalid",
      "input_nav_policy_mismatch",
      "scenario_vector_hash_mismatch",
      "input_matrix_hash_mismatch",
      "draw_plan_hash_mismatch",
      "input_nav_shape_invalid",
      "invalid_nav",
      "sample_count_exceeds_path_count",
      "sample_count_exceeds_limit",
      "sample_output_too_large",
    ]);
  });

  it("uses one exact null-zero projection for every blocked result", () => {
    const input = syntheticSpaghettiPathSampleInput({ sampleCount: 0 });
    const result = sampleSimulationSpaghettiPaths(input);

    assertBlockedProjection(result);
    assert.deepEqual(Object.keys(result).sort(), [
      "blockers",
      "drawPlanHash",
      "horizon",
      "inputMatrixHash",
      "inputPathCount",
      "policy",
      "runtimeTrustStatus",
      "sampleStatus",
      "scenarioId",
      "scenarioVectorHash",
      "scenarioVersion",
      "selectedPathCount",
      "selectedPaths",
      "totalInputPointCount",
      "totalOutputPointCount",
    ]);
  });

  it("does not consume or expose point provenance", () => {
    const left = syntheticSpaghettiPathSampleInput({
      provenanceVariant: "left",
    });
    const right = syntheticSpaghettiPathSampleInput({
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

    const leftResult = sampleSimulationSpaghettiPaths(left);
    const rightResult = sampleSimulationSpaghettiPaths(right);
    assert.deepEqual(leftResult, rightResult);
    assert.doesNotMatch(
      JSON.stringify(leftResult),
      /drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate/,
    );
  });

  it("returns a minimized deeply immutable selected-path result", () => {
    const result = sampleSimulationSpaghettiPaths(
      syntheticSpaghettiPathSampleInput(),
    );
    const serialized = JSON.stringify(result);

    assert.deepEqual(Object.keys(result).sort(), [
      "blockers",
      "drawPlanHash",
      "horizon",
      "inputMatrixHash",
      "inputPathCount",
      "policy",
      "runtimeTrustStatus",
      "sampleStatus",
      "scenarioId",
      "scenarioVectorHash",
      "scenarioVersion",
      "selectedPathCount",
      "selectedPaths",
      "totalInputPointCount",
      "totalOutputPointCount",
    ]);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.policy), true);
    assert.equal(Object.isFrozen(result.selectedPaths), true);
    result.selectedPaths.forEach((path) => {
      assert.deepEqual(Object.keys(path).sort(), ["pathIndex", "points"]);
      assert.equal(Object.isFrozen(path), true);
      assert.equal(Object.isFrozen(path.points), true);
      path.points.forEach((point) => {
        assert.deepEqual(Object.keys(point).sort(), ["nav", "stepIndex"]);
        assert.equal(Object.isFrozen(point), true);
      });
    });
    assert.equal(Object.isFrozen(result.blockers), true);
    assert.doesNotMatch(
      serialized,
      /drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate|canonicalVector|weightBps|owner|user[_-]?id|approval|provider|p10|p50|p90/i,
    );
  });

  it("keeps policy, blocker order, and source boundaries exact", () => {
    const sourcePaths = [
      "src/lib/simulation-spaghetti-path-sampling-policy.ts",
      "src/lib/simulation-spaghetti-path-sampling-types.ts",
      "src/lib/simulation-spaghetti-path-sampling-validation.ts",
      "src/lib/simulation-spaghetti-path-sampling.ts",
    ];
    const source = sourcePaths
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.deepEqual(SIMULATION_SPAGHETTI_PATH_SAMPLE_POLICY, {
      version: "simulation_spaghetti_path_sample_v1",
      inputNavVersion: "simulation_normalized_nav_v1",
      selectionAlgorithm: "canonical_index_even_spacing_v1",
      sampleCountSource: "caller_explicit",
      sampleCountBehavior: "exact_or_block",
      pathTreatment: "validate_all_then_select",
      pointTreatment: "complete_selected_paths",
      runtimeTrustStatus: "not_established",
      maxInputNavPoints: 1_000_000,
      maxSelectedPaths: 64,
      maxOutputPoints: 16_384,
      outputKind: "dimensionless_deterministic_nav_path_subset",
    });
    assert.deepEqual(
      [...SIMULATION_SPAGHETTI_PATH_SAMPLE_BLOCKER_ORDER],
      [
        "input_nav_not_ready",
        "input_nav_runtime_trust_invalid",
        "input_nav_policy_mismatch",
        "expected_binding_invalid",
        "scenario_vector_hash_mismatch",
        "input_matrix_hash_mismatch",
        "draw_plan_hash_mismatch",
        "input_nav_shape_invalid",
        "input_nav_too_large",
        "invalid_nav",
        "sample_count_invalid",
        "sample_count_exceeds_path_count",
        "sample_count_exceeds_limit",
        "sample_output_too_large",
        "invalid_selection",
      ],
    );
    assert.doesNotMatch(
      source,
      /drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate|simulation-normalized-nav-distribution-summary|@\/db|drizzle|neon|DATABASE_URL|process\.env|node:fs|\bfetch\s*\(|Math\.random|next\/|initialKrw|optimizer/i,
    );
  });
});

function selectedIndices(result) {
  assert.equal(result.sampleStatus, "ready");
  return result.selectedPaths.map((path) => path.pathIndex);
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
  assert.equal(result.sampleStatus, "blocked");
  assert.equal(result.runtimeTrustStatus, "not_established");
  assert.equal(result.scenarioId, null);
  assert.equal(result.scenarioVersion, null);
  assert.equal(result.scenarioVectorHash, null);
  assert.equal(result.inputMatrixHash, null);
  assert.equal(result.drawPlanHash, null);
  assert.equal(result.horizon, 0);
  assert.equal(result.inputPathCount, 0);
  assert.equal(result.selectedPathCount, 0);
  assert.equal(result.totalInputPointCount, 0);
  assert.equal(result.totalOutputPointCount, 0);
  assert.deepEqual(result.selectedPaths, []);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.selectedPaths), true);
}

function syntheticCapSizedSpaghettiPathSampleInput({
  pathCount,
  pointCount,
  sampleCount,
}) {
  const input = syntheticSpaghettiPathSampleInput({ sampleCount });
  const points = Array.from({ length: pointCount }, (_, stepIndex) => ({
    stepIndex,
    nav: stepIndex === 0 ? 1 : 1 + stepIndex / 1_000_000,
  }));
  const totalPointCount = pathCount * pointCount;

  input.normalizedNav.horizon = pointCount - 1;
  input.normalizedNav.pathCount = pathCount;
  input.normalizedNav.totalPointCount = totalPointCount;
  input.normalizedNav.totalNavCells = totalPointCount;
  input.normalizedNav.paths = Array.from({ length: pathCount }, (_, pathIndex) => ({
    pathIndex,
    points,
  }));

  return input;
}
