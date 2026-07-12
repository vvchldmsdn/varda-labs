import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_TERMINAL_LOSS_PROBABILITY_BLOCKER_ORDER,
  SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY,
  calculateSimulationTerminalLossProbability,
} from "../src/lib/simulation-terminal-loss-probability.ts";
import {
  SYNTHETIC_TERMINAL_LOSS_DRAW_PLAN_HASH,
  SYNTHETIC_TERMINAL_LOSS_INPUT_MATRIX_HASH,
  SYNTHETIC_TERMINAL_LOSS_SCENARIO_VECTOR_HASH,
  syntheticTerminalLossPoint,
  syntheticTerminalLossProbabilityInput,
} from "./fixtures/simulation-terminal-loss-probability.mjs";

describe("Simulation terminal loss probability Phase 1F0", () => {
  it("calculates the strict terminal loss count over all validated paths", () => {
    const result = calculateSimulationTerminalLossProbability(
      syntheticTerminalLossProbabilityInput(),
    );

    assert.equal(result.lossStatus, "ready");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.scenarioId, "synthetic-terminal-loss");
    assert.equal(
      result.scenarioVectorHash,
      SYNTHETIC_TERMINAL_LOSS_SCENARIO_VECTOR_HASH,
    );
    assert.equal(
      result.inputMatrixHash,
      SYNTHETIC_TERMINAL_LOSS_INPUT_MATRIX_HASH,
    );
    assert.equal(result.drawPlanHash, SYNTHETIC_TERMINAL_LOSS_DRAW_PLAN_HASH);
    assert.equal(result.horizon, 2);
    assert.equal(result.pathCount, 5);
    assert.equal(result.totalPointCount, 15);
    assert.equal(result.lossPathCount, 2);
    assert.equal(result.lossProbability, 2 / 5);
    assert.deepEqual(result.blockers, []);
  });

  it("uses a strict no-epsilon boundary below, equal to, and above one", () => {
    const result = calculateSimulationTerminalLossProbability(
      syntheticTerminalLossProbabilityInput({
        pathNavs: [
          [1, 1, 1 - Number.EPSILON],
          [1, 1, 1],
          [1, 1, 1 + Number.EPSILON],
        ],
      }),
    );

    assert.equal(result.lossStatus, "ready");
    assert.equal(result.lossPathCount, 1);
    assert.equal(result.pathCount, 3);
    assert.equal(result.lossProbability, 1 / 3);
    assert.equal(typeof result.lossProbability, "number");
  });

  it("handles one-path, no-loss, all-loss, and mixed samples", () => {
    const cases = [
      { terminals: [0.8], expected: 1 },
      { terminals: [1, 1.2], expected: 0 },
      { terminals: [0.8, 0.9], expected: 2 },
      { terminals: [0.8, 1, 1.2, 0.7], expected: 2 },
    ];

    for (const { terminals, expected } of cases) {
      const result = calculateSimulationTerminalLossProbability(
        syntheticTerminalLossProbabilityInput({
          pathNavs: terminals.map((terminal) => [1, terminal]),
        }),
      );
      assert.equal(result.lossStatus, "ready");
      assert.equal(result.lossPathCount, expected);
      assert.equal(result.lossProbability, expected / terminals.length);
    }
  });

  it("keeps count and probability invariants across representative path counts", () => {
    for (let pathCount = 1; pathCount <= 32; pathCount += 1) {
      const pathNavs = Array.from({ length: pathCount }, (_, pathIndex) => [
        1,
        pathIndex % 2 === 0 ? 0.9 : 1.1,
      ]);
      const result = calculateSimulationTerminalLossProbability(
        syntheticTerminalLossProbabilityInput({ pathNavs }),
      );
      const expectedLossCount = Math.ceil(pathCount / 2);

      assert.equal(result.lossStatus, "ready");
      assert.equal(result.lossPathCount, expectedLossCount);
      assert.equal(result.lossProbability, expectedLossCount / pathCount);
      assert.equal(Number.isFinite(result.lossProbability), true);
      assert.ok(result.lossProbability >= 0 && result.lossProbability <= 1);
    }
  });

  it("blocks noncanonical paths without sorting or relabeling", () => {
    const outOfOrder = syntheticTerminalLossProbabilityInput();
    outOfOrder.normalizedNav.paths.reverse();
    const mismatchedIndex = syntheticTerminalLossProbabilityInput();
    mismatchedIndex.normalizedNav.paths[1].pathIndex = 9;
    const before = structuredClone(outOfOrder);

    assertBlocked(calculateSimulationTerminalLossProbability(outOfOrder), [
      "input_nav_shape_invalid",
    ]);
    assertBlocked(
      calculateSimulationTerminalLossProbability(mismatchedIndex),
      ["input_nav_shape_invalid"],
    );
    assert.deepEqual(outOfOrder, before);
  });

  it("does not fabricate semantic blockers before top-level shape exists", () => {
    const missingArtifact = syntheticTerminalLossProbabilityInput();
    missingArtifact.normalizedNav = null;
    const emptyArtifact = syntheticTerminalLossProbabilityInput();
    emptyArtifact.normalizedNav = {};
    const missingRequiredKey = syntheticTerminalLossProbabilityInput();
    delete missingRequiredKey.normalizedNav.runtimeTrustStatus;

    for (const input of [
      missingArtifact,
      emptyArtifact,
      missingRequiredKey,
    ]) {
      assertBlocked(calculateSimulationTerminalLossProbability(input), [
        "input_nav_not_ready",
        "input_nav_shape_invalid",
      ]);
    }
  });

  it("retains independent binding errors for malformed NAV input", () => {
    const input = syntheticTerminalLossProbabilityInput();
    input.normalizedNav = null;
    delete input.expectedBinding.expectedDrawPlanHash;

    assertBlocked(calculateSimulationTerminalLossProbability(input), [
      "input_nav_not_ready",
      "expected_binding_invalid",
      "input_nav_shape_invalid",
    ]);
  });

  it("keeps status, blockers, runtime trust, and policy drift distinct", () => {
    const status = syntheticTerminalLossProbabilityInput();
    status.normalizedNav.calculationStatus = "blocked";
    const blockers = syntheticTerminalLossProbabilityInput();
    blockers.normalizedNav.blockers.push({ reason: "synthetic" });
    const trust = syntheticTerminalLossProbabilityInput();
    trust.normalizedNav.runtimeTrustStatus = "established";
    const policy = structuredClone(syntheticTerminalLossProbabilityInput());
    policy.normalizedNav.policy.version = "synthetic_wrong_version";

    assertBlocked(calculateSimulationTerminalLossProbability(status), [
      "input_nav_not_ready",
    ]);
    assertBlocked(calculateSimulationTerminalLossProbability(blockers), [
      "input_nav_not_ready",
    ]);
    assertBlocked(calculateSimulationTerminalLossProbability(trust), [
      "input_nav_runtime_trust_invalid",
    ]);
    assertBlocked(calculateSimulationTerminalLossProbability(policy), [
      "input_nav_policy_mismatch",
    ]);
  });

  it("validates the expected binding before comparing separate hashes", () => {
    const invalidBinding = syntheticTerminalLossProbabilityInput();
    delete invalidBinding.expectedBinding.expectedDrawPlanHash;
    const mismatches = syntheticTerminalLossProbabilityInput();
    mismatches.normalizedNav.scenarioVectorHash = `sha256:${"a".repeat(64)}`;
    mismatches.normalizedNav.inputMatrixHash = `sha256:${"b".repeat(64)}`;
    mismatches.normalizedNav.drawPlanHash = `sha256:${"c".repeat(64)}`;

    assertBlocked(
      calculateSimulationTerminalLossProbability(invalidBinding),
      ["expected_binding_invalid"],
    );
    assertBlocked(calculateSimulationTerminalLossProbability(mismatches), [
      "scenario_vector_hash_mismatch",
      "input_matrix_hash_mismatch",
      "draw_plan_hash_mismatch",
    ]);
  });

  it("rejects malformed steps, invalid NAV, and baseline drift", () => {
    const stepShape = syntheticTerminalLossProbabilityInput();
    stepShape.normalizedNav.paths[0].points[1].stepIndex = 7;
    const invalidNav = syntheticTerminalLossProbabilityInput();
    invalidNav.normalizedNav.paths[0].points[1].nav = 0;
    const baseline = syntheticTerminalLossProbabilityInput();
    baseline.normalizedNav.paths[0].points[0].nav = 1.01;

    assertBlocked(calculateSimulationTerminalLossProbability(stepShape), [
      "input_nav_shape_invalid",
    ]);
    assertBlocked(calculateSimulationTerminalLossProbability(invalidNav), [
      "invalid_nav",
    ]);
    assertBlocked(calculateSimulationTerminalLossProbability(baseline), [
      "invalid_nav",
    ]);
  });

  it("blocks the whole result for an invalid nonterminal point", () => {
    const input = syntheticTerminalLossProbabilityInput({
      pathNavs: [
        [1, 1.1, 1.2],
        [1, 0.9, 1.1],
        [1, 1.2, 1.3],
      ],
    });
    input.normalizedNav.paths[1].points[1].nav = Number.NaN;

    assertBlocked(calculateSimulationTerminalLossProbability(input), [
      "invalid_nav",
    ]);
  });

  it("accepts a valid one-million-point artifact and blocks only over-cap size", () => {
    const atCap = syntheticCapSizedInput({
      pathCount: 64,
      pointCount: 15_625,
      terminalNav: 0.99,
    });
    const atCapResult = calculateSimulationTerminalLossProbability(atCap);

    assert.equal(
      SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY.maxInputNavPoints,
      1_000_000,
    );
    assert.equal(atCapResult.lossStatus, "ready");
    assert.equal(atCapResult.pathCount, 64);
    assert.equal(atCapResult.totalPointCount, 1_000_000);
    assert.equal(atCapResult.lossPathCount, 64);
    assert.equal(atCapResult.lossProbability, 1);

    const overCap = syntheticCapSizedInput({
      pathCount: 65,
      pointCount: 15_385,
      terminalNav: 0.99,
    });
    assertBlocked(calculateSimulationTerminalLossProbability(overCap), [
      "input_nav_too_large",
    ]);
  });

  it("returns all safely applicable blockers once in fixed order", () => {
    const input = structuredClone(syntheticTerminalLossProbabilityInput());
    input.normalizedNav.calculationStatus = "blocked";
    input.normalizedNav.runtimeTrustStatus = "established";
    input.normalizedNav.policy.version = "synthetic_wrong_version";
    input.normalizedNav.scenarioVectorHash = `sha256:${"a".repeat(64)}`;
    input.normalizedNav.inputMatrixHash = `sha256:${"b".repeat(64)}`;
    input.normalizedNav.drawPlanHash = `sha256:${"c".repeat(64)}`;
    input.normalizedNav.unexpected = "not reflected";
    input.normalizedNav.paths[0].points[1].nav = 0;

    assertBlocked(calculateSimulationTerminalLossProbability(input), [
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
    const input = syntheticTerminalLossProbabilityInput();
    input.normalizedNav.paths[0].points[1].nav = Number.NaN;
    const result = calculateSimulationTerminalLossProbability(input);

    assertBlockedProjection(result);
    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
  });

  it("does not consume point provenance fields", () => {
    const left = syntheticTerminalLossProbabilityInput({
      provenanceVariant: "left",
    });
    const right = syntheticTerminalLossProbabilityInput({
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
      calculateSimulationTerminalLossProbability(left),
      calculateSimulationTerminalLossProbability(right),
    );
  });

  it("returns minimized deeply immutable output without mutating input", () => {
    const input = syntheticTerminalLossProbabilityInput();
    const before = structuredClone(input);
    const result = calculateSimulationTerminalLossProbability(input);
    const serialized = JSON.stringify(result);

    assert.deepEqual(input, before);
    assert.deepEqual(Object.keys(result).sort(), RESULT_KEYS);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.policy), true);
    assert.equal(Object.isFrozen(result.blockers), true);
    assert.doesNotMatch(
      serialized,
      /"paths"|terminalNav|drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate|canonicalVector|weightBps|owner|user[_-]?id|approval|drawdown|percentile/i,
    );
  });

  it("keeps the implementation pure and outside later risk phases", () => {
    const sourcePaths = [
      "src/lib/simulation-terminal-loss-probability-policy.ts",
      "src/lib/simulation-terminal-loss-probability-types.ts",
      "src/lib/simulation-terminal-loss-probability-validation.ts",
      "src/lib/simulation-terminal-loss-probability.ts",
    ];
    const source = sourcePaths
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.deepEqual(
      [...SIMULATION_TERMINAL_LOSS_PROBABILITY_BLOCKER_ORDER],
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
        "invalid_terminal_loss_count",
        "invalid_terminal_loss_probability",
      ],
    );
    assert.deepEqual(SIMULATION_TERMINAL_LOSS_PROBABILITY_POLICY, {
      version: "simulation_terminal_loss_probability_v1",
      inputNavVersion: "simulation_normalized_nav_v1",
      lossDefinition: "strict_terminal_nav_below_literal_one_v1",
      probabilityDenominator: "all_validated_paths_v1",
      pathTreatment: "all_paths_or_block",
      runtimeTrustStatus: "not_established",
      maxInputNavPoints: 1_000_000,
      outputKind: "dimensionless_terminal_loss_probability",
    });
    assert.doesNotMatch(
      source,
      /drawStepIndex|sourceRowIndex|previousServiceDate|serviceDate|simulation-normalized-nav-distribution|simulation-spaghetti|pathDrawdown|expectedShortfall|@\/db|drizzle|neon|DATABASE_URL|process\.env|node:fs|\bfetch\s*\(|Math\.random|next\/|initialKrw|optimizer/i,
    );
  });
});

const RESULT_KEYS = [
  "blockers",
  "drawPlanHash",
  "horizon",
  "inputMatrixHash",
  "lossPathCount",
  "lossProbability",
  "lossStatus",
  "pathCount",
  "policy",
  "runtimeTrustStatus",
  "scenarioId",
  "scenarioVectorHash",
  "scenarioVersion",
  "totalPointCount",
];

function syntheticCapSizedInput({ pathCount, pointCount, terminalNav }) {
  const input = syntheticTerminalLossProbabilityInput({
    pathNavs: [[1, terminalNav]],
  });
  const sharedPoints = Array.from({ length: pointCount }, (_, stepIndex) =>
    syntheticTerminalLossPoint({
      nav: stepIndex === 0 ? 1 : stepIndex === pointCount - 1 ? terminalNav : 1,
      stepIndex,
    }),
  );
  const totalPointCount = pathCount * pointCount;

  input.normalizedNav.horizon = pointCount - 1;
  input.normalizedNav.pathCount = pathCount;
  input.normalizedNav.totalPointCount = totalPointCount;
  input.normalizedNav.totalNavCells = totalPointCount;
  input.normalizedNav.paths = Array.from({ length: pathCount }, (_, pathIndex) => ({
    pathIndex,
    points: sharedPoints,
  }));
  return input;
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
  assert.equal(result.lossStatus, "blocked");
  assert.equal(result.runtimeTrustStatus, "not_established");
  assert.equal(result.scenarioId, null);
  assert.equal(result.scenarioVersion, null);
  assert.equal(result.scenarioVectorHash, null);
  assert.equal(result.inputMatrixHash, null);
  assert.equal(result.drawPlanHash, null);
  assert.equal(result.horizon, 0);
  assert.equal(result.pathCount, 0);
  assert.equal(result.totalPointCount, 0);
  assert.equal(result.lossPathCount, 0);
  assert.equal(result.lossProbability, null);
  assert.equal(Object.isFrozen(result), true);
}
