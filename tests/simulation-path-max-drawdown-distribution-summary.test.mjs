import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_BLOCKER_ORDER,
  SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY,
  summarizeSimulationPathMaxDrawdownDistribution,
} from "../src/lib/simulation-path-max-drawdown-distribution-summary.ts";
import {
  SYNTHETIC_DRAWDOWN_SUMMARY_DRAW_PLAN_HASH,
  SYNTHETIC_DRAWDOWN_SUMMARY_INPUT_MATRIX_HASH,
  SYNTHETIC_DRAWDOWN_SUMMARY_SCENARIO_VECTOR_HASH,
  syntheticPathMaxDrawdownDistributionSummaryInput,
  syntheticUniformPathMaxDrawdownDistributionSummaryInput,
} from "./fixtures/simulation-path-max-drawdown-distribution-summary.mjs";

const RESULT_KEYS = [
  "blockers",
  "drawPlanHash",
  "horizon",
  "inputMatrixHash",
  "maxDrawdownQuantiles",
  "pathCount",
  "policy",
  "runtimeTrustStatus",
  "scenarioId",
  "scenarioVectorHash",
  "scenarioVersion",
  "summaryStatus",
  "totalPointCount",
];

describe("Simulation path maximum drawdown distribution Phase 1F1", () => {
  it("calculates pinned odd-sample Type 7 p50 and p90", () => {
    const result = summarizeSimulationPathMaxDrawdownDistribution(
      syntheticPathMaxDrawdownDistributionSummaryInput(),
    );

    assert.equal(result.summaryStatus, "ready");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.scenarioId, "synthetic-drawdown-summary");
    assert.equal(
      result.scenarioVectorHash,
      SYNTHETIC_DRAWDOWN_SUMMARY_SCENARIO_VECTOR_HASH,
    );
    assert.equal(
      result.inputMatrixHash,
      SYNTHETIC_DRAWDOWN_SUMMARY_INPUT_MATRIX_HASH,
    );
    assert.equal(
      result.drawPlanHash,
      SYNTHETIC_DRAWDOWN_SUMMARY_DRAW_PLAN_HASH,
    );
    assert.equal(result.horizon, 2);
    assert.equal(result.pathCount, 5);
    assert.equal(result.totalPointCount, 15);
    assertClose(result.maxDrawdownQuantiles.p50, 0.2);
    assertClose(result.maxDrawdownQuantiles.p90, 0.36);
  });

  it("pins the exact Phase 1F1 policy projection", () => {
    assert.deepEqual(
      SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY,
      {
        version: "simulation_path_max_drawdown_distribution_summary_v1",
        inputDrawdownVersion: "simulation_path_max_drawdown_v1",
        quantileAlgorithm: "hyndman_fan_type_7_v1",
        quantileProbabilities: [0.5, 0.9],
        pathTreatment: "all_paths_or_block",
        pathWeighting: "equal",
        drawdownDirection: "larger_is_worse",
        drawdownUnit: "dimensionless_loss_fraction",
        runtimeTrustStatus: "not_established",
        maxInputPathDrawdownRows: 500_000,
        outputKind:
          "dimensionless_empirical_max_drawdown_quantile_summary",
      },
    );
  });

  it("handles one path and even-sample interpolation", () => {
    const one = summarizeSimulationPathMaxDrawdownDistribution(
      syntheticPathMaxDrawdownDistributionSummaryInput({
        drawdowns: [0.25],
      }),
    );
    const even = summarizeSimulationPathMaxDrawdownDistribution(
      syntheticPathMaxDrawdownDistributionSummaryInput({
        drawdowns: [0, 0.2, 0.4, 0.6],
      }),
    );

    assertClose(one.maxDrawdownQuantiles.p50, 0.25);
    assertClose(one.maxDrawdownQuantiles.p90, 0.25);
    assertClose(even.maxDrawdownQuantiles.p50, 0.3);
    assertClose(even.maxDrawdownQuantiles.p90, 0.54);
  });

  it("retains duplicates and emits literal positive zero", () => {
    const duplicates = summarizeSimulationPathMaxDrawdownDistribution(
      syntheticPathMaxDrawdownDistributionSummaryInput({
        drawdowns: [0.1, 0.1, 0.4, 0.4, 0.4],
      }),
    );
    const zeros = summarizeSimulationPathMaxDrawdownDistribution(
      syntheticPathMaxDrawdownDistributionSummaryInput({
        drawdowns: [0, 0, 0],
      }),
    );

    assertClose(duplicates.maxDrawdownQuantiles.p50, 0.4);
    assertClose(duplicates.maxDrawdownQuantiles.p90, 0.4);
    assert.equal(zeros.maxDrawdownQuantiles.p50, 0);
    assert.equal(zeros.maxDrawdownQuantiles.p90, 0);
    assert.equal(Object.is(zeros.maxDrawdownQuantiles.p50, -0), false);
    assert.equal(Object.is(zeros.maxDrawdownQuantiles.p90, -0), false);
  });

  it("is invariant to path assignment and does not mutate input", () => {
    const left = syntheticPathMaxDrawdownDistributionSummaryInput({
      drawdowns: [0.4, 0.1, 0.3, 0.2],
    });
    const right = syntheticPathMaxDrawdownDistributionSummaryInput({
      drawdowns: [0.2, 0.4, 0.1, 0.3],
    });
    const leftBefore = structuredClone(left);
    const rightBefore = structuredClone(right);

    const leftResult = summarizeSimulationPathMaxDrawdownDistribution(left);
    const rightResult = summarizeSimulationPathMaxDrawdownDistribution(right);

    assert.deepEqual(
      leftResult.maxDrawdownQuantiles,
      rightResult.maxDrawdownQuantiles,
    );
    assert.deepEqual(left, leftBefore);
    assert.deepEqual(right, rightBefore);
  });

  it("returns exact prerequisite blockers for non-record wrappers", () => {
    for (const input of [null, 7, "invalid", []]) {
      assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(input), [
        "input_drawdown_not_ready",
        "expected_binding_invalid",
        "input_drawdown_shape_invalid",
      ]);
    }
  });

  it("does not fabricate semantic blockers before artifact shape exists", () => {
    const missingArtifact = syntheticPathMaxDrawdownDistributionSummaryInput();
    delete missingArtifact.pathMaxDrawdown;
    const nullArtifact = syntheticPathMaxDrawdownDistributionSummaryInput();
    nullArtifact.pathMaxDrawdown = null;
    const missingRequiredKey =
      syntheticPathMaxDrawdownDistributionSummaryInput();
    delete missingRequiredKey.pathMaxDrawdown.runtimeTrustStatus;

    for (const input of [
      missingArtifact,
      nullArtifact,
      missingRequiredKey,
    ]) {
      assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(input), [
        "input_drawdown_not_ready",
        "input_drawdown_shape_invalid",
      ]);
    }
  });

  it("keeps malformed binding classification independent", () => {
    const input = syntheticPathMaxDrawdownDistributionSummaryInput();
    input.pathMaxDrawdown = null;
    delete input.expectedBinding.expectedDrawPlanHash;

    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(input), [
      "input_drawdown_not_ready",
      "expected_binding_invalid",
      "input_drawdown_shape_invalid",
    ]);
  });

  it("enforces enumerable string key sets", () => {
    const wrapper = syntheticPathMaxDrawdownDistributionSummaryInput();
    wrapper.extra = "blocked";
    const artifact = syntheticPathMaxDrawdownDistributionSummaryInput();
    artifact.pathMaxDrawdown.extra = "blocked";
    const row = syntheticPathMaxDrawdownDistributionSummaryInput();
    row.pathMaxDrawdown.pathDrawdowns[0].extra = "blocked";
    const binding = syntheticPathMaxDrawdownDistributionSummaryInput();
    binding.expectedBinding.extra = "blocked";

    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(wrapper), [
      "input_drawdown_shape_invalid",
    ]);
    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(artifact), [
      "input_drawdown_shape_invalid",
    ]);
    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(row), [
      "input_drawdown_shape_invalid",
    ]);
    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(binding), [
      "expected_binding_invalid",
    ]);
  });

  it("does not consume symbol or non-enumerable extra properties", () => {
    const input = syntheticPathMaxDrawdownDistributionSummaryInput();
    const targets = [
      input,
      input.pathMaxDrawdown,
      input.pathMaxDrawdown.pathDrawdowns[0],
      input.expectedBinding,
    ];

    for (const [index, target] of targets.entries()) {
      Object.defineProperty(target, `hidden${index}`, {
        configurable: true,
        enumerable: false,
        get() {
          throw new Error("non-enumerable property was consumed");
        },
      });
      Object.defineProperty(target, Symbol(`hidden${index}`), {
        configurable: true,
        enumerable: true,
        get() {
          throw new Error("symbol property was consumed");
        },
      });
    }

    const result = summarizeSimulationPathMaxDrawdownDistribution(input);

    assert.equal(result.summaryStatus, "ready");
    assert.doesNotMatch(JSON.stringify(result), /hidden/i);
  });

  it("does not consume a non-enumerable required field", () => {
    const input = syntheticPathMaxDrawdownDistributionSummaryInput();
    delete input.pathMaxDrawdown.scenarioId;
    Object.defineProperty(input.pathMaxDrawdown, "scenarioId", {
      enumerable: false,
      get() {
        throw new Error("hidden required field was consumed");
      },
    });

    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(input), [
      "input_drawdown_not_ready",
      "input_drawdown_shape_invalid",
    ]);
  });

  it("keeps status, trust, policy, and binding failures distinct", () => {
    const status = syntheticPathMaxDrawdownDistributionSummaryInput();
    status.pathMaxDrawdown.drawdownStatus = "blocked";
    const trust = syntheticPathMaxDrawdownDistributionSummaryInput();
    trust.pathMaxDrawdown.runtimeTrustStatus = "established";
    const policy = structuredClone(
      syntheticPathMaxDrawdownDistributionSummaryInput(),
    );
    policy.pathMaxDrawdown.policy.version = "synthetic_wrong_version";
    const binding = syntheticPathMaxDrawdownDistributionSummaryInput();
    delete binding.expectedBinding.expectedDrawPlanHash;

    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(status), [
      "input_drawdown_not_ready",
    ]);
    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(trust), [
      "input_drawdown_runtime_trust_invalid",
    ]);
    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(policy), [
      "input_drawdown_policy_mismatch",
    ]);
    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(binding), [
      "expected_binding_invalid",
    ]);
  });

  it("compares all three hashes only after binding validation", () => {
    const mismatches = syntheticPathMaxDrawdownDistributionSummaryInput();
    mismatches.pathMaxDrawdown.scenarioVectorHash =
      `sha256:${"d".repeat(64)}`;
    mismatches.pathMaxDrawdown.inputMatrixHash =
      `sha256:${"e".repeat(64)}`;
    mismatches.pathMaxDrawdown.drawPlanHash = `sha256:${"f".repeat(64)}`;

    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(mismatches), [
      "scenario_vector_hash_mismatch",
      "input_matrix_hash_mismatch",
      "draw_plan_hash_mismatch",
    ]);
  });

  it("blocks row order, cardinality, and count drift without repair", () => {
    const order = syntheticPathMaxDrawdownDistributionSummaryInput();
    order.pathMaxDrawdown.pathDrawdowns.reverse();
    const index = syntheticPathMaxDrawdownDistributionSummaryInput();
    index.pathMaxDrawdown.pathDrawdowns[1].pathIndex = 9;
    const cardinality = syntheticPathMaxDrawdownDistributionSummaryInput();
    cardinality.pathMaxDrawdown.pathDrawdowns.pop();
    const count = syntheticPathMaxDrawdownDistributionSummaryInput();
    count.pathMaxDrawdown.totalPointCount += 1;

    for (const input of [order, index, cardinality, count]) {
      assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(input), [
        "input_drawdown_shape_invalid",
      ]);
    }
  });

  it("rejects every invalid drawdown domain value", () => {
    for (const maxDrawdown of [
      -0,
      -0.01,
      1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      const input = syntheticPathMaxDrawdownDistributionSummaryInput();
      input.pathMaxDrawdown.pathDrawdowns[2].maxDrawdown = maxDrawdown;

      assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(input), [
        "invalid_drawdown",
      ]);
    }
  });

  it("does not summarize a valid subset after one invalid row", () => {
    const input = syntheticPathMaxDrawdownDistributionSummaryInput();
    input.pathMaxDrawdown.pathDrawdowns[4].maxDrawdown = Number.NaN;
    const result = summarizeSimulationPathMaxDrawdownDistribution(input);

    assertBlocked(result, ["invalid_drawdown"]);
    assert.equal(result.maxDrawdownQuantiles, null);
  });

  it("calculates the exact 500,000-row boundary", () => {
    const input = syntheticUniformPathMaxDrawdownDistributionSummaryInput({
      pathCount: 500_000,
      maxDrawdown: 0,
    });
    const result = summarizeSimulationPathMaxDrawdownDistribution(input);

    assert.equal(
      SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_POLICY.maxInputPathDrawdownRows,
      500_000,
    );
    assert.equal(result.summaryStatus, "ready");
    assert.equal(result.pathCount, 500_000);
    assert.equal(result.totalPointCount, 1_000_000);
    assert.deepEqual(result.maxDrawdownQuantiles, { p50: 0, p90: 0 });
  });

  it("blocks 500,001 rows before row scan or sort allocation", () => {
    const input = syntheticUniformPathMaxDrawdownDistributionSummaryInput({
      pathCount: 500_001,
      materializeRows: false,
    });

    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(input), [
      "input_drawdown_too_large",
    ]);
  });

  it("returns all applicable blockers once in policy order", () => {
    const input = structuredClone(
      syntheticPathMaxDrawdownDistributionSummaryInput(),
    );
    input.pathMaxDrawdown.drawdownStatus = "blocked";
    input.pathMaxDrawdown.runtimeTrustStatus = "established";
    input.pathMaxDrawdown.policy.version = "synthetic_wrong_version";
    input.pathMaxDrawdown.scenarioVectorHash = `sha256:${"d".repeat(64)}`;
    input.pathMaxDrawdown.inputMatrixHash = `sha256:${"e".repeat(64)}`;
    input.pathMaxDrawdown.drawPlanHash = `sha256:${"f".repeat(64)}`;
    input.pathMaxDrawdown.extra = "not reflected";
    input.pathMaxDrawdown.pathDrawdowns[0].maxDrawdown = Number.NaN;

    assertBlocked(summarizeSimulationPathMaxDrawdownDistribution(input), [
      "input_drawdown_not_ready",
      "input_drawdown_runtime_trust_invalid",
      "input_drawdown_policy_mismatch",
      "scenario_vector_hash_mismatch",
      "input_matrix_hash_mismatch",
      "draw_plan_hash_mismatch",
      "input_drawdown_shape_invalid",
      "invalid_drawdown",
    ]);
  });

  it("uses one minimized immutable blocked projection", () => {
    const input = syntheticPathMaxDrawdownDistributionSummaryInput();
    input.pathMaxDrawdown.pathDrawdowns[0].maxDrawdown = Number.NaN;
    const result = summarizeSimulationPathMaxDrawdownDistribution(input);

    assertBlockedProjection(result);
    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
  });

  it("returns minimized deeply immutable ready output", () => {
    const result = summarizeSimulationPathMaxDrawdownDistribution(
      syntheticPathMaxDrawdownDistributionSummaryInput(),
    );
    const serialized = JSON.stringify(result);

    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.policy), true);
    assert.equal(Object.isFrozen(result.policy.quantileProbabilities), true);
    assert.equal(Object.isFrozen(result.maxDrawdownQuantiles), true);
    assert.equal(Object.isFrozen(result.blockers), true);
    assert.doesNotMatch(
      serialized,
      /pathDrawdowns|expectedBinding|expected_mdd|cvar|owner|user[_-]?id|approval|date/i,
    );
  });

  it("keeps the implementation pure and outside runtime execution", () => {
    const sourcePaths = [
      "src/lib/simulation-path-max-drawdown-distribution-summary-policy.ts",
      "src/lib/simulation-path-max-drawdown-distribution-summary-types.ts",
      "src/lib/simulation-path-max-drawdown-distribution-summary-validation.ts",
      "src/lib/simulation-path-max-drawdown-distribution-summary.ts",
    ];
    const source = sourcePaths
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.deepEqual(
      [
        ...SIMULATION_PATH_MAX_DRAWDOWN_DISTRIBUTION_SUMMARY_BLOCKER_ORDER,
      ],
      [
        "input_drawdown_not_ready",
        "input_drawdown_runtime_trust_invalid",
        "input_drawdown_policy_mismatch",
        "expected_binding_invalid",
        "scenario_vector_hash_mismatch",
        "input_matrix_hash_mismatch",
        "draw_plan_hash_mismatch",
        "input_drawdown_shape_invalid",
        "input_drawdown_too_large",
        "invalid_drawdown",
        "invalid_quantile",
      ],
    );
    assert.doesNotMatch(
      source,
      /Reflect\.ownKeys|Object\.assign|@\/db|drizzle|neon|DATABASE_URL|process\.env|node:fs|\bfetch\s*\(|Math\.random|next\/|expected_mdd|cvar|optimizer/i,
    );
  });
});

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
  assert.equal(result.maxDrawdownQuantiles, null);
  assert.equal(Object.isFrozen(result), true);
}
