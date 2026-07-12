import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_PATH_MAX_DRAWDOWN_BLOCKER_ORDER,
  SIMULATION_PATH_MAX_DRAWDOWN_POLICY,
  calculateSimulationPathMaxDrawdowns,
} from "../src/lib/simulation-path-max-drawdown.ts";
import {
  SYNTHETIC_MAX_DRAWDOWN_DRAW_PLAN_HASH,
  SYNTHETIC_MAX_DRAWDOWN_INPUT_MATRIX_HASH,
  SYNTHETIC_MAX_DRAWDOWN_SCENARIO_VECTOR_HASH,
  syntheticPathMaxDrawdownInput,
  syntheticSharedTwoPointMaxDrawdownInput,
} from "./fixtures/simulation-path-max-drawdown.mjs";

describe("Simulation per-path maximum drawdown Phase 1F0", () => {
  it("calculates one running-peak maximum drawdown per canonical path", () => {
    const result = calculateSimulationPathMaxDrawdowns(
      syntheticPathMaxDrawdownInput(),
    );

    assert.equal(result.drawdownStatus, "ready");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.scenarioId, "synthetic-max-drawdown");
    assert.equal(
      result.scenarioVectorHash,
      SYNTHETIC_MAX_DRAWDOWN_SCENARIO_VECTOR_HASH,
    );
    assert.equal(
      result.inputMatrixHash,
      SYNTHETIC_MAX_DRAWDOWN_INPUT_MATRIX_HASH,
    );
    assert.equal(result.drawPlanHash, SYNTHETIC_MAX_DRAWDOWN_DRAW_PLAN_HASH);
    assert.equal(result.horizon, 3);
    assert.equal(result.pathCount, 4);
    assert.equal(result.totalPointCount, 16);
    assert.deepEqual(result.pathDrawdowns, [
      { pathIndex: 0, maxDrawdown: 0.25 },
      { pathIndex: 1, maxDrawdown: 0.5 },
      { pathIndex: 2, maxDrawdown: 0 },
      { pathIndex: 3, maxDrawdown: 0.30000000000000004 },
    ]);
  });

  it("returns literal positive zero for a nondecreasing path", () => {
    const result = calculateSimulationPathMaxDrawdowns(
      syntheticPathMaxDrawdownInput({ pathNavs: [[1, 1, 1.2, 1.2]] }),
    );

    assert.equal(result.drawdownStatus, "ready");
    assert.equal(result.pathDrawdowns[0].maxDrawdown, 0);
    assert.equal(Object.is(result.pathDrawdowns[0].maxDrawdown, -0), false);
  });

  it("includes the baseline peak and retains an earlier trough after recovery", () => {
    const beforeNewHigh = calculateSimulationPathMaxDrawdowns(
      syntheticPathMaxDrawdownInput({ pathNavs: [[1, 0.7, 0.9, 1.1]] }),
    );
    const afterNewHigh = calculateSimulationPathMaxDrawdowns(
      syntheticPathMaxDrawdownInput({ pathNavs: [[1, 1.5, 0.75, 1.4]] }),
    );

    assert.equal(beforeNewHigh.pathDrawdowns[0].maxDrawdown, 0.30000000000000004);
    assert.equal(afterNewHigh.pathDrawdowns[0].maxDrawdown, 0.5);
  });

  it("blocks floating-point underflow instead of clamping drawdown to one", () => {
    const input = syntheticPathMaxDrawdownInput({
      pathNavs: [[1, Number.MAX_VALUE, Number.MIN_VALUE]],
    });

    assertBlocked(calculateSimulationPathMaxDrawdowns(input), [
      "invalid_drawdown",
    ]);
  });

  it("returns no partial rows when a later path has invalid drawdown", () => {
    const input = syntheticPathMaxDrawdownInput({
      pathNavs: [
        [1, 1.2, 0.9],
        [1, 1.1, 1.2],
        [1, Number.MAX_VALUE, Number.MIN_VALUE],
      ],
    });
    const result = calculateSimulationPathMaxDrawdowns(input);

    assertBlocked(result, ["invalid_drawdown"]);
    assert.deepEqual(result.pathDrawdowns, []);
  });

  it("blocks noncanonical input without sorting or relabeling", () => {
    const outOfOrder = syntheticPathMaxDrawdownInput();
    outOfOrder.normalizedNav.paths.reverse();
    const mismatchedIndex = syntheticPathMaxDrawdownInput();
    mismatchedIndex.normalizedNav.paths[1].pathIndex = 9;
    const before = structuredClone(outOfOrder);

    assertBlocked(calculateSimulationPathMaxDrawdowns(outOfOrder), [
      "input_nav_shape_invalid",
    ]);
    assertBlocked(calculateSimulationPathMaxDrawdowns(mismatchedIndex), [
      "input_nav_shape_invalid",
    ]);
    assert.deepEqual(outOfOrder, before);
  });

  it("keeps malformed prerequisites and independent binding errors coherent", () => {
    const missingArtifact = syntheticPathMaxDrawdownInput();
    missingArtifact.normalizedNav = null;
    const missingArtifactAndBinding = syntheticPathMaxDrawdownInput();
    missingArtifactAndBinding.normalizedNav = null;
    delete missingArtifactAndBinding.expectedBinding.expectedDrawPlanHash;

    assertBlocked(calculateSimulationPathMaxDrawdowns(missingArtifact), [
      "input_nav_not_ready",
      "input_nav_shape_invalid",
    ]);
    assertBlocked(
      calculateSimulationPathMaxDrawdowns(missingArtifactAndBinding),
      [
        "input_nav_not_ready",
        "expected_binding_invalid",
        "input_nav_shape_invalid",
      ],
    );
  });

  it("keeps status, trust, policy, and three hash mismatches distinct", () => {
    const status = syntheticPathMaxDrawdownInput();
    status.normalizedNav.calculationStatus = "blocked";
    const trust = syntheticPathMaxDrawdownInput();
    trust.normalizedNav.runtimeTrustStatus = "established";
    const policy = structuredClone(syntheticPathMaxDrawdownInput());
    policy.normalizedNav.policy.version = "synthetic_wrong_version";
    const hashes = syntheticPathMaxDrawdownInput();
    hashes.normalizedNav.scenarioVectorHash = `sha256:${"d".repeat(64)}`;
    hashes.normalizedNav.inputMatrixHash = `sha256:${"e".repeat(64)}`;
    hashes.normalizedNav.drawPlanHash = `sha256:${"f".repeat(64)}`;

    assertBlocked(calculateSimulationPathMaxDrawdowns(status), [
      "input_nav_not_ready",
    ]);
    assertBlocked(calculateSimulationPathMaxDrawdowns(trust), [
      "input_nav_runtime_trust_invalid",
    ]);
    assertBlocked(calculateSimulationPathMaxDrawdowns(policy), [
      "input_nav_policy_mismatch",
    ]);
    assertBlocked(calculateSimulationPathMaxDrawdowns(hashes), [
      "scenario_vector_hash_mismatch",
      "input_matrix_hash_mismatch",
      "draw_plan_hash_mismatch",
    ]);
  });

  it("rejects malformed steps, invalid NAV, and baseline drift", () => {
    const stepShape = syntheticPathMaxDrawdownInput();
    stepShape.normalizedNav.paths[0].points[1].stepIndex = 8;
    const invalidNav = syntheticPathMaxDrawdownInput();
    invalidNav.normalizedNav.paths[0].points[1].nav = 0;
    const baseline = syntheticPathMaxDrawdownInput();
    baseline.normalizedNav.paths[0].points[0].nav = 1.01;

    assertBlocked(calculateSimulationPathMaxDrawdowns(stepShape), [
      "input_nav_shape_invalid",
    ]);
    assertBlocked(calculateSimulationPathMaxDrawdowns(invalidNav), [
      "invalid_nav",
    ]);
    assertBlocked(calculateSimulationPathMaxDrawdowns(baseline), [
      "invalid_nav",
    ]);
  });

  it("materializes the exact 500,000-row derived boundary", () => {
    const input = syntheticSharedTwoPointMaxDrawdownInput({
      pathCount: 500_000,
    });
    const result = calculateSimulationPathMaxDrawdowns(input);

    assert.equal(result.drawdownStatus, "ready");
    assert.equal(result.pathCount, 500_000);
    assert.equal(result.totalPointCount, 1_000_000);
    assert.equal(result.pathDrawdowns.length, 500_000);
    assert.deepEqual(result.pathDrawdowns[0], {
      pathIndex: 0,
      maxDrawdown: 0,
    });
    assert.deepEqual(result.pathDrawdowns[250_000], {
      pathIndex: 250_000,
      maxDrawdown: 0,
    });
    assert.deepEqual(result.pathDrawdowns[499_999], {
      pathIndex: 499_999,
      maxDrawdown: 0,
    });
    for (let pathIndex = 0; pathIndex < result.pathDrawdowns.length; pathIndex += 1) {
      const row = result.pathDrawdowns[pathIndex];
      assert.equal(row.pathIndex, pathIndex);
      assert.equal(row.maxDrawdown, 0);
      assert.equal(Object.is(row.maxDrawdown, -0), false);
    }
    assert.equal(Object.isFrozen(result.pathDrawdowns), true);
    assert.equal(Object.isFrozen(result.pathDrawdowns[0]), true);
    assert.equal(Object.isFrozen(result.pathDrawdowns[250_000]), true);
    assert.equal(Object.isFrozen(result.pathDrawdowns[499_999]), true);
  });

  it("blocks 500,001 rows before output allocation", () => {
    const input = syntheticSharedTwoPointMaxDrawdownInput({
      pathCount: 500_001,
    });
    const result = calculateSimulationPathMaxDrawdowns(input);

    assert.equal(input.normalizedNav.totalPointCount, 1_000_002);
    assertBlocked(result, ["input_nav_too_large"]);
    assert.deepEqual(result.pathDrawdowns, []);
  });

  it("returns all applicable shared blockers once in fixed order", () => {
    const input = structuredClone(syntheticPathMaxDrawdownInput());
    input.normalizedNav.calculationStatus = "blocked";
    input.normalizedNav.runtimeTrustStatus = "established";
    input.normalizedNav.policy.version = "synthetic_wrong_version";
    input.normalizedNav.scenarioVectorHash = `sha256:${"d".repeat(64)}`;
    input.normalizedNav.inputMatrixHash = `sha256:${"e".repeat(64)}`;
    input.normalizedNav.drawPlanHash = `sha256:${"f".repeat(64)}`;
    input.normalizedNav.unexpected = "not reflected";
    input.normalizedNav.paths[0].points[1].nav = 0;

    assertBlocked(calculateSimulationPathMaxDrawdowns(input), [
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

  it("uses one exact null-zero-empty projection when blocked", () => {
    const input = syntheticPathMaxDrawdownInput();
    input.normalizedNav.paths[0].points[1].nav = Number.NaN;
    const result = calculateSimulationPathMaxDrawdowns(input);

    assertBlockedProjection(result);
    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
  });

  it("does not consume point provenance fields", () => {
    const left = syntheticPathMaxDrawdownInput({
      provenanceVariant: "left",
    });
    const right = syntheticPathMaxDrawdownInput({
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
      calculateSimulationPathMaxDrawdowns(left),
      calculateSimulationPathMaxDrawdowns(right),
    );
  });

  it("returns minimized deeply immutable output without mutating input", () => {
    const input = syntheticPathMaxDrawdownInput();
    const before = structuredClone(input);
    const result = calculateSimulationPathMaxDrawdowns(input);
    const serialized = JSON.stringify(result);

    assert.deepEqual(input, before);
    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.policy), true);
    assert.equal(Object.isFrozen(result.pathDrawdowns), true);
    result.pathDrawdowns.forEach((row) => assert.equal(Object.isFrozen(row), true));
    assert.equal(Object.isFrozen(result.blockers), true);
    assert.doesNotMatch(
      serialized,
      /"paths"|runningPeak|peakRatio|drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate|canonicalVector|weightBps|owner|user[_-]?id|approval|percentile|expectedShortfall/i,
    );
  });

  it("keeps the implementation pure and outside aggregate risk phases", () => {
    const sourcePaths = [
      "src/lib/simulation-path-risk-input-policy.ts",
      "src/lib/simulation-path-risk-input-validation.ts",
      "src/lib/simulation-path-max-drawdown-policy.ts",
      "src/lib/simulation-path-max-drawdown-types.ts",
      "src/lib/simulation-path-max-drawdown-validation.ts",
      "src/lib/simulation-path-max-drawdown.ts",
    ];
    const source = sourcePaths
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.deepEqual([...SIMULATION_PATH_MAX_DRAWDOWN_BLOCKER_ORDER], [
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
      "invalid_drawdown",
    ]);
    assert.deepEqual(SIMULATION_PATH_MAX_DRAWDOWN_POLICY, {
      version: "simulation_path_max_drawdown_v1",
      inputNavVersion: "simulation_normalized_nav_v1",
      drawdownAlgorithm: "running_peak_from_literal_step_zero_v1",
      drawdownDefinition: "one_minus_nav_div_running_peak_v1",
      signConvention: "nonnegative_loss_fraction",
      pathTreatment: "all_paths_or_block",
      resultTreatment: "per_path_only",
      runtimeTrustStatus: "not_established",
      maxInputNavPoints: 1_000_000,
      maxPathDrawdownRows: 500_000,
      pathDrawdownCardinality: "exactly_one_per_validated_path_v1",
      pathDrawdownLimitBehavior: "exact_or_block",
      outputKind: "dimensionless_per_path_max_drawdown",
    });
    assert.doesNotMatch(
      source,
      /drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate|simulation-normalized-nav-distribution|simulation-spaghetti|terminal-loss-probability|expectedShortfall|@\/db|drizzle|neon|DATABASE_URL|process\.env|node:fs|\bfetch\s*\(|Math\.random|next\/|initialKrw|optimizer/i,
    );
  });
});

const RESULT_KEYS = [
  "blockers",
  "drawPlanHash",
  "drawdownStatus",
  "horizon",
  "inputMatrixHash",
  "pathCount",
  "pathDrawdowns",
  "policy",
  "runtimeTrustStatus",
  "scenarioId",
  "scenarioVectorHash",
  "scenarioVersion",
  "totalPointCount",
];

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
  assert.equal(result.drawdownStatus, "blocked");
  assert.equal(result.runtimeTrustStatus, "not_established");
  assert.equal(result.scenarioId, null);
  assert.equal(result.scenarioVersion, null);
  assert.equal(result.scenarioVectorHash, null);
  assert.equal(result.inputMatrixHash, null);
  assert.equal(result.drawPlanHash, null);
  assert.equal(result.horizon, 0);
  assert.equal(result.pathCount, 0);
  assert.equal(result.totalPointCount, 0);
  assert.deepEqual(result.pathDrawdowns, []);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.pathDrawdowns), true);
}
