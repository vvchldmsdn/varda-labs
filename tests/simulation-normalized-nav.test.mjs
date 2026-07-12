import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_NORMALIZED_NAV_POLICY,
  materializeSimulationNormalizedNav,
} from "../src/lib/simulation-normalized-nav.ts";
import {
  SYNTHETIC_DRAW_PLAN_HASH,
  SYNTHETIC_INPUT_MATRIX_HASH,
  syntheticMagnitudeSkewInput,
  syntheticNormalizedNavInput,
} from "./fixtures/simulation-normalized-nav.mjs";

describe("Simulation normalized NAV Phase 1C", () => {
  it("materializes deterministic dimensionless NAV paths from synthetic evidence", () => {
    const input = syntheticNormalizedNavInput();
    const result = materializeSimulationNormalizedNav(input);

    assert.equal(result.calculationStatus, "ready");
    assert.equal(result.runtimeTrustStatus, "not_established");
    assert.equal(result.policy.version, "simulation_normalized_nav_v1");
    assert.equal(
      result.policy.weightedSumAlgorithm,
      "neumaier_compensated_sum_v1",
    );
    assert.equal(result.scenarioId, "synthetic-nav");
    assert.equal(
      result.scenarioVectorHash,
      input.scenarioVector.scenarioVectorHash,
    );
    assert.equal(result.inputMatrixHash, SYNTHETIC_INPUT_MATRIX_HASH);
    assert.equal(result.drawPlanHash, SYNTHETIC_DRAW_PLAN_HASH);
    assert.equal(result.horizon, 2);
    assert.equal(result.pathCount, 2);
    assert.equal(result.totalPointCount, 6);
    assert.equal(result.totalNavCells, 6);
    assertNavs(result.paths[0], [1, 1.02, 1.122]);
    assertNavs(result.paths[1], [1, 0.96, 0.96]);
    assert.deepEqual(result.paths[0].points[1], {
      stepIndex: 1,
      drawStepIndex: 0,
      sourceRowIndex: 0,
      previousServiceDate: "2026-01-01",
      serviceDate: "2026-01-02",
      nav: result.paths[0].points[1].nav,
    });
  });

  it("emits a literal one baseline and deeply freezes ready output", () => {
    const result = materializeSimulationNormalizedNav(
      syntheticMagnitudeSkewInput(),
    );

    assert.equal(result.paths[0].points[0].nav, 1);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.paths), true);
    assert.equal(Object.isFrozen(result.paths[0]), true);
    assert.equal(Object.isFrozen(result.paths[0].points), true);
    assert.equal(Object.isFrozen(result.paths[0].points[0]), true);
  });

  it("uses the pinned Neumaier recurrence for magnitude-skewed terms", () => {
    const input = syntheticMagnitudeSkewInput();
    const result = materializeSimulationNormalizedNav(input);
    const naive = [1e16, 1, 1].reduce((sum, value) => sum + value, 0);

    assert.equal(naive, 10_000_000_000_000_000);
    assert.equal(result.calculationStatus, "ready");
    assert.equal(
      result.paths[0].points[1].nav,
      10_000_000_000_000_002,
    );
  });

  it("supports one instrument and an explicit zero-weight instrument", () => {
    const oneInstrument = syntheticNormalizedNavInput({
      scenarioId: "synthetic-one-instrument",
      vector: [syntheticRow("alpha", "KRW", "SYN_A", 10_000)],
      pathFactorRows: [[
        [1.25],
        [1.5],
      ]],
    });
    const zeroWeight = syntheticNormalizedNavInput({
      scenarioId: "synthetic-zero-weight",
      vector: [
        syntheticRow("alpha", "KRW", "SYN_A", 10_000),
        syntheticRow("omega", "USD", "SYN_B", 0),
      ],
      pathFactorRows: [[
        [1.1, 9_999],
      ]],
    });

    assertNavs(
      materializeSimulationNormalizedNav(oneInstrument).paths[0],
      [1, 1.25, 1.5],
    );
    assertNavs(
      materializeSimulationNormalizedNav(zeroWeight).paths[0],
      [1, 1.1],
    );
  });

  it("still blocks an invalid factor carried by a zero-weight instrument", () => {
    const input = syntheticNormalizedNavInput({
      scenarioId: "synthetic-zero-weight-invalid",
      vector: [
        syntheticRow("alpha", "KRW", "SYN_A", 10_000),
        syntheticRow("omega", "USD", "SYN_B", 0),
      ],
      pathFactorRows: [[
        [1.1, 1],
      ]],
    });
    input.grossGrowth.paths[0].points[1].grossGrowthFactors[1].value = 0;

    assertBlocked(
      materializeSimulationNormalizedNav(input),
      "invalid_growth_factor",
    );
  });

  it("fails closed on scenario vector hash and exact-total mismatches", () => {
    const hashMismatch = structuredClone(syntheticNormalizedNavInput());
    hashMismatch.scenarioVector.scenarioVectorHash = `sha256:${"f".repeat(64)}`;
    const wrongTotal = syntheticNormalizedNavInput({
      scenarioId: "synthetic-wrong-total",
      vector: [
        syntheticRow("alpha", "KRW", "SYN_A", 5_999),
        syntheticRow("omega", "USD", "SYN_B", 4_000),
      ],
      pathFactorRows: [[
        [1, 1],
      ]],
    });

    assertBlocked(
      materializeSimulationNormalizedNav(hashMismatch),
      "scenario_vector_hash_mismatch",
    );
    assertBlocked(
      materializeSimulationNormalizedNav(wrongTotal),
      "scenario_vector_invalid",
    );
  });

  it("keeps matrix and draw-plan hash bindings separate", () => {
    const matrixMismatch = structuredClone(syntheticNormalizedNavInput());
    matrixMismatch.expectedBinding.expectedInputMatrixHash =
      `sha256:${"3".repeat(64)}`;
    const drawMismatch = structuredClone(syntheticNormalizedNavInput());
    drawMismatch.expectedBinding.expectedDrawPlanHash =
      `sha256:${"4".repeat(64)}`;

    assertBlocked(
      materializeSimulationNormalizedNav(matrixMismatch),
      "input_matrix_hash_mismatch",
    );
    assertBlocked(
      materializeSimulationNormalizedNav(drawMismatch),
      "draw_plan_hash_mismatch",
    );
  });

  it("rejects out-of-order vectors and gross-growth instruments without sorting", () => {
    const vectorOrder = structuredClone(syntheticNormalizedNavInput());
    vectorOrder.scenarioVector.canonicalVector.reverse();

    const grossOrder = structuredClone(syntheticNormalizedNavInput());
    grossOrder.grossGrowth.instrumentKeys.reverse();
    for (const path of grossOrder.grossGrowth.paths) {
      for (const point of path.points) {
        point.grossGrowthFactors.reverse();
      }
    }

    assertBlocked(
      materializeSimulationNormalizedNav(vectorOrder),
      "scenario_vector_not_canonical",
    );
    assertBlocked(
      materializeSimulationNormalizedNav(grossOrder),
      "instrument_order_mismatch",
    );
  });

  it("rejects Phase 1B status, blocker, and exact-policy mismatches", () => {
    const blockedArtifact = structuredClone(syntheticNormalizedNavInput());
    blockedArtifact.grossGrowth.status = "blocked";
    const artifactWithBlocker = structuredClone(syntheticNormalizedNavInput());
    artifactWithBlocker.grossGrowth.blockers.push({
      reason: "invalid_growth_factor",
    });
    const policyMismatch = structuredClone(syntheticNormalizedNavInput());
    policyMismatch.grossGrowth.policy.version = "synthetic_wrong_version";

    assertBlocked(
      materializeSimulationNormalizedNav(blockedArtifact),
      "input_gross_growth_not_ready",
    );
    assertBlocked(
      materializeSimulationNormalizedNav(artifactWithBlocker),
      "input_gross_growth_not_ready",
    );
    assertBlocked(
      materializeSimulationNormalizedNav(policyMismatch),
      "input_gross_growth_policy_mismatch",
    );
  });

  it("checks the NAV memory cap before allocating output paths", () => {
    const input = structuredClone(syntheticNormalizedNavInput());
    input.grossGrowth.horizon = 1_000_000;
    input.grossGrowth.pathCount = 1;
    input.grossGrowth.totalPointCount = 1_000_001;
    input.grossGrowth.totalGrowthFactorCells = 2_000_002;
    input.grossGrowth.paths = [];

    assertBlocked(
      materializeSimulationNormalizedNav(input),
      "nav_output_too_large",
    );
  });

  it("rejects malformed provenance, factor order, and baseline evidence", () => {
    const provenance = structuredClone(syntheticNormalizedNavInput());
    provenance.grossGrowth.paths[0].points[1].serviceDate = "2026-99-99";
    const factorOrder = structuredClone(syntheticNormalizedNavInput());
    factorOrder.grossGrowth.paths[0].points[1].grossGrowthFactors[0].instrumentKey =
      "alpha|KRW|SYN_Z";
    const baseline = structuredClone(syntheticNormalizedNavInput());
    baseline.grossGrowth.paths[0].points[0].grossGrowthFactors[0].value = 1.01;

    assertBlocked(
      materializeSimulationNormalizedNav(provenance),
      "input_gross_growth_shape_invalid",
    );
    assertBlocked(
      materializeSimulationNormalizedNav(factorOrder),
      "input_gross_growth_shape_invalid",
    );
    assertBlocked(
      materializeSimulationNormalizedNav(baseline),
      "invalid_growth_factor",
    );
  });

  it("blocks a whole result when positive factors underflow to zero NAV", () => {
    const input = syntheticNormalizedNavInput({
      scenarioId: "synthetic-underflow",
      vector: [
        syntheticRow("alpha", "KRW", "SYN_A", 5_000),
        syntheticRow("omega", "USD", "SYN_B", 5_000),
      ],
      pathFactorRows: [[
        [Number.MIN_VALUE, Number.MIN_VALUE],
      ]],
    });

    assertBlocked(materializeSimulationNormalizedNav(input), "invalid_nav");
  });

  it("returns only normalized calculation evidence and never runtime approval", () => {
    const result = materializeSimulationNormalizedNav(
      syntheticNormalizedNavInput(),
    );
    const serialized = JSON.stringify(result);

    assert.deepEqual(Object.keys(result).sort(), [
      "blockers",
      "calculationStatus",
      "drawPlanHash",
      "horizon",
      "inputMatrixHash",
      "pathCount",
      "paths",
      "policy",
      "runtimeTrustStatus",
      "scenarioId",
      "scenarioVectorHash",
      "scenarioVersion",
      "totalNavCells",
      "totalPointCount",
    ]);
    assert.equal(
      SIMULATION_NORMALIZED_NAV_POLICY.runtimeTrustStatus,
      "not_established",
    );
    assert.doesNotMatch(
      serialized,
      /canonicalVector|weightBps|grossGrowthFactors|terminalKrw|initialCapital|approved|owner|user[_-]?id/i,
    );
  });
});

function syntheticRow(market, currency, ticker, weightBps) {
  return { market, currency, ticker, weightBps };
}

function assertNavs(path, expected) {
  assert.equal(path.points.length, expected.length);
  path.points.forEach((point, index) => {
    assert.ok(
      Math.abs(point.nav - expected[index]) <= Number.EPSILON * 8,
      `${point.nav} !== ${expected[index]}`,
    );
  });
}

function assertBlocked(result, reason) {
  assert.equal(result.calculationStatus, "blocked");
  assert.equal(result.runtimeTrustStatus, "not_established");
  assert.deepEqual(result.paths, []);
  assert.ok(
    result.blockers.some((blocker) => blocker.reason === reason),
    JSON.stringify(result.blockers),
  );
}
