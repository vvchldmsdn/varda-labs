import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildSimulationReturnMatrix } from "../src/lib/simulation-return-matrix.ts";
import {
  STATIONARY_BOOTSTRAP_POLICY,
  buildStationaryBootstrapDrawPlan,
} from "../src/lib/simulation-stationary-bootstrap.ts";
import {
  crossMarketSimulationFixture,
  instrument,
  price,
} from "./fixtures/simulation-return-matrix.mjs";

describe("Simulation Validation stationary bootstrap Phase 1A", () => {
  it("pins the exact mulberry32 stationary-bootstrap draw sequence", () => {
    const result = buildPlan();

    assert.equal(result.status, "ready");
    assert.equal(
      result.inputMatrixHash,
      "sha256:601f1d84143b104b4158706a3e15aea3483ff7beb80dc6435f18186ae70ca435",
    );
    assert.equal(
      result.drawPlanHash,
      "sha256:a35848e61338cfc888f49810f604e1cf91de9a4c6bd60eb0dc0b21e10e24391f",
    );
    assert.equal(result.restartProbability, 0.5);
    assert.equal(result.totalPlannedDraws, 16);
    assert.deepEqual(
      result.paths.map((path) =>
        path.draws.map((draw) => [draw.sourceRowIndex, draw.blockStart]),
      ),
      [
        [
          [0, true],
          [1, false],
          [0, false],
          [0, true],
          [1, false],
          [0, false],
          [0, true],
          [0, true],
        ],
        [
          [0, true],
          [1, false],
          [0, true],
          [1, false],
          [0, false],
          [1, true],
          [0, false],
          [0, true],
        ],
      ],
    );
  });

  it("returns an identical plan for the same matrix, parameters, and seed", () => {
    assert.deepEqual(buildPlan(), buildPlan());
  });

  it("keeps earlier paths stable when later paths are appended", () => {
    const onePath = buildPlan({ pathCount: 1 });
    const threePaths = buildPlan({ pathCount: 3 });

    assert.deepEqual(onePath.paths[0], threePaths.paths[0]);
  });

  it("changes reproducibility evidence when seed, block length, or matrix changes", () => {
    const baseline = buildPlan();
    const changedSeed = buildPlan({ seed: 123_456_790 });
    const changedBlock = buildPlan({ expectedBlockLength: 1 });
    const fixture = crossMarketSimulationFixture();
    fixture.priceRows[1] = {
      ...fixture.priceRows[1],
      adjustedClosePrice: 103,
    };
    const changedMatrix = buildPlan({
      matrix: buildSimulationReturnMatrix(fixture),
    });

    assert.equal(changedSeed.inputMatrixHash, baseline.inputMatrixHash);
    assert.notEqual(changedSeed.drawPlanHash, baseline.drawPlanHash);
    assert.equal(changedBlock.inputMatrixHash, baseline.inputMatrixHash);
    assert.notEqual(changedBlock.drawPlanHash, baseline.drawPlanHash);
    assert.notEqual(changedMatrix.inputMatrixHash, baseline.inputMatrixHash);
    assert.notEqual(changedMatrix.drawPlanHash, baseline.drawPlanHash);
  });

  it("samples one whole matrix row for every cross-asset draw", () => {
    const matrix = readyMatrix();
    const result = buildPlan({ matrix });

    for (const path of result.paths) {
      for (const draw of path.draws) {
        const sourceRow = matrix.matrix[draw.sourceRowIndex];
        assert.equal(sourceRow.cells.length, 2);
        assert.equal(draw.previousServiceDate, sourceRow.previousServiceDate);
        assert.equal(draw.serviceDate, sourceRow.serviceDate);
        assert.deepEqual(Object.keys(draw), [
          "stepIndex",
          "sourceRowIndex",
          "previousServiceDate",
          "serviceDate",
          "blockStart",
        ]);
      }
    }
    assert.doesNotMatch(JSON.stringify(result.paths), /instrument|return|value/i);
  });

  it("continues circularly from the final source row to the first", () => {
    const draws = buildPlan().paths[0].draws;
    const circularPair = draws.find(
      (draw, index) =>
        index > 0 &&
        draws[index - 1].sourceRowIndex === 1 &&
        draw.sourceRowIndex === 0 &&
        draw.blockStart === false,
    );

    assert.ok(circularPair);
  });

  it("starts a new block at every later step when expected length is one", () => {
    const result = buildPlan({ expectedBlockLength: 1 });

    assert.ok(
      result.paths.every((path) =>
        path.draws.every((draw) => draw.blockStart === true),
      ),
    );
  });

  it("accepts a ready one-instrument return matrix", () => {
    const matrix = buildSimulationReturnMatrix({
      requestedServiceDates: [
        "2026-07-04",
        "2026-07-07",
        "2026-07-08",
      ],
      instruments: [instrument("069500", "korea", "KRW")],
      priceRows: [
        price("069500", "korea", "KRW", "2026-07-03", 100),
        price("069500", "korea", "KRW", "2026-07-06", 101),
        price("069500", "korea", "KRW", "2026-07-07", 102),
      ],
      fxRows: [],
    });
    const result = buildPlan({ matrix, expectedBlockLength: 2 });

    assert.equal(matrix.status, "ready");
    assert.equal(result.status, "ready");
    assert.equal(result.instrumentCount, 1);
  });

  it("rejects incomplete, blocked, and tampered ready matrices", () => {
    const incompleteFixture = crossMarketSimulationFixture();
    incompleteFixture.priceRows = incompleteFixture.priceRows.filter(
      (row) => !(row.ticker === "VOO" && row.priceDate === "2026-07-02"),
    );
    const blockedFixture = crossMarketSimulationFixture();
    blockedFixture.priceRows.push({ ...blockedFixture.priceRows[0] });
    const tampered = JSON.parse(JSON.stringify(readyMatrix()));
    tampered.matrix[0].cells.pop();

    assertBlocked(
      buildPlan({ matrix: buildSimulationReturnMatrix(incompleteFixture) }),
      "input_matrix_not_ready",
    );
    assertBlocked(
      buildPlan({ matrix: buildSimulationReturnMatrix(blockedFixture) }),
      "input_matrix_not_ready",
    );
    assertBlocked(
      buildPlan({ matrix: tampered }),
      "input_matrix_shape_invalid",
    );
  });

  it("fails closed for invalid seed, block length, horizon, path count, and size", () => {
    const matrix = readyMatrix();
    const variants = [
      { seed: -1, blocker: "invalid_seed" },
      { seed: 0x1_0000_0000, blocker: "invalid_seed" },
      { seed: 1.5, blocker: "invalid_seed" },
      { expectedBlockLength: 0, blocker: "invalid_expected_block_length" },
      { expectedBlockLength: 3, blocker: "invalid_expected_block_length" },
      { expectedBlockLength: 1.5, blocker: "invalid_expected_block_length" },
      { horizon: 0, blocker: "invalid_horizon" },
      { horizon: 1.5, blocker: "invalid_horizon" },
      { pathCount: 0, blocker: "invalid_path_count" },
      { pathCount: 1.5, blocker: "invalid_path_count" },
      { horizon: 1_000_001, pathCount: 1, blocker: "draw_plan_too_large" },
    ];

    for (const variant of variants) {
      assertBlocked(buildPlan({ matrix, ...variant }), variant.blocker);
    }
  });

  it("has no production defaults, ambient seed, wealth math, runtime, or model coupling", () => {
    const source = [
      "src/lib/simulation-prng.ts",
      "src/lib/simulation-stationary-bootstrap-serialization.ts",
      "src/lib/simulation-stationary-bootstrap-types.ts",
      "src/lib/simulation-stationary-bootstrap.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const result = buildPlan();

    assert.equal(STATIONARY_BOOTSTRAP_POLICY.productionDefaults, "forbidden");
    assert.equal(STATIONARY_BOOTSTRAP_POLICY.outputKind, "draw_plan_only");
    assert.doesNotMatch(source, /Math\.random|Date\.now|randomBytes|randomUUID/i);
    assert.doesNotMatch(
      source,
      /wealth|terminal|compound|factor.?model|optimizer|recommendation|target-policy|ma120|additional-contribution/i,
    );
    assert.doesNotMatch(
      source,
      /@\/db|drizzle|neon|server-only|fetch\s*\(|\/api\/|route|provider|blob|insert\s+into|update\s+\w+\s+set/i,
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /instrumentKey|internal|legacy|owner|user[_-]?id/i,
    );
  });
});

function buildPlan(overrides = {}) {
  return buildStationaryBootstrapDrawPlan({
    matrix: readyMatrix(),
    seed: 123_456_789,
    expectedBlockLength: 2,
    horizon: 8,
    pathCount: 2,
    ...overrides,
  });
}

function readyMatrix() {
  return buildSimulationReturnMatrix(crossMarketSimulationFixture());
}

function assertBlocked(result, reason) {
  assert.equal(result.status, "blocked");
  assert.equal(result.drawPlanHash, null);
  assert.deepEqual(result.paths, []);
  assert.ok(
    result.blockers.some((blocker) => blocker.reason === reason),
    JSON.stringify(result.blockers),
  );
}
