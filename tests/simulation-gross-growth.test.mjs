import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_GROSS_GROWTH_POLICY,
  materializeSimulationGrossGrowth,
} from "../src/lib/simulation-gross-growth.ts";
import { buildSimulationReturnMatrix } from "../src/lib/simulation-return-matrix.ts";
import { buildStationaryBootstrapDrawPlan } from "../src/lib/simulation-stationary-bootstrap.ts";
import {
  instrument,
  price,
} from "./fixtures/simulation-return-matrix.mjs";

describe("Simulation Validation gross growth Phase 1B", () => {
  it("compounds deterministic multi-instrument paths from the supplied draw plan", () => {
    const matrix = growthMatrix();
    const drawPlan = buildPlan(matrix);
    const result = materializeSimulationGrossGrowth({ matrix, drawPlan });

    assert.equal(result.status, "ready");
    assert.deepEqual(result.instrumentKeys, [
      "korea|KRW|069500",
      "korea|KRW|114800",
    ]);
    assert.equal(result.totalPointCount, 10);
    assert.equal(result.totalGrowthFactorCells, 20);
    assert.deepEqual(
      result.paths.map((path) =>
        path.points.map((point) => point.sourceRowIndex),
      ),
      [
        [null, 0, 2, 0, 2],
        [null, 0, 0, 1, 0],
      ],
    );
    assertFactors(result.paths[0], [
      [1, 1],
      [1.1, 1],
      [1.1, 0.5],
      [1.21, 0.5],
      [1.21, 0.25],
    ]);
    assertFactors(result.paths[1], [
      [1, 1],
      [1.1, 1],
      [1.21, 1],
      [1.089, 1.2],
      [1.1979, 1.2],
    ]);
  });

  it("keeps baseline one and preserves canonical source provenance", () => {
    const matrix = growthMatrix();
    const drawPlan = buildPlan(matrix, { pathCount: 1 });
    const result = materializeSimulationGrossGrowth({ matrix, drawPlan });
    const [baseline, ...sampled] = result.paths[0].points;

    assert.deepEqual(baseline, {
      stepIndex: 0,
      drawStepIndex: null,
      sourceRowIndex: null,
      previousServiceDate: null,
      serviceDate: null,
      grossGrowthFactors: [
        { instrumentKey: "korea|KRW|069500", value: 1 },
        { instrumentKey: "korea|KRW|114800", value: 1 },
      ],
    });
    for (const point of sampled) {
      const draw = drawPlan.paths[0].draws[point.drawStepIndex];
      assert.equal(point.stepIndex, draw.stepIndex + 1);
      assert.equal(point.sourceRowIndex, draw.sourceRowIndex);
      assert.equal(point.previousServiceDate, draw.previousServiceDate);
      assert.equal(point.serviceDate, draw.serviceDate);
    }
  });

  it("supports a one-instrument matrix without portfolio aggregation", () => {
    const matrix = buildSimulationReturnMatrix({
      requestedServiceDates: ["2026-07-02", "2026-07-03"],
      instruments: [instrument("069500", "korea", "KRW")],
      priceRows: [
        price("069500", "korea", "KRW", "2026-07-01", 100),
        price("069500", "korea", "KRW", "2026-07-02", 125),
      ],
      fxRows: [],
    });
    const drawPlan = buildPlan(matrix, {
      horizon: 2,
      pathCount: 1,
      expectedBlockLength: 1,
    });
    const result = materializeSimulationGrossGrowth({ matrix, drawPlan });

    assert.equal(result.status, "ready");
    assertFactors(result.paths[0], [[1], [1.25], [1.5625]]);
  });

  it("fails closed for a sampled return at or below minus one", () => {
    for (const value of [-1, -1.01]) {
      const matrix = singleRowMatrix(value);
      const drawPlan = buildPlan(matrix, {
        horizon: 1,
        pathCount: 1,
        expectedBlockLength: 1,
      });
      assertBlocked(
        materializeSimulationGrossGrowth({ matrix, drawPlan }),
        "invalid_sampled_return",
      );
    }
  });

  it("fails closed when compounding overflows finite number range", () => {
    const matrix = singleRowMatrix(Number.MAX_VALUE);
    const drawPlan = buildPlan(matrix, {
      horizon: 2,
      pathCount: 1,
      expectedBlockLength: 1,
    });

    assertBlocked(
      materializeSimulationGrossGrowth({ matrix, drawPlan }),
      "invalid_growth_factor",
    );
  });

  it("rejects incomplete matrices and blocked plans", () => {
    const input = growthFixture();
    input.priceRows = input.priceRows.filter(
      (row) => row.ticker !== "114800",
    );
    const matrix = buildSimulationReturnMatrix(input);
    const drawPlan = buildPlan(matrix);
    const result = materializeSimulationGrossGrowth({ matrix, drawPlan });

    assert.equal(matrix.status, "incomplete");
    assertBlocked(result, "input_matrix_not_ready");
  });

  it("rejects matrix/hash mismatch and tampered plan hash", () => {
    const matrix = growthMatrix();
    const drawPlan = buildPlan(matrix);
    const changedInput = growthFixture();
    changedInput.priceRows[1] = {
      ...changedInput.priceRows[1],
      adjustedClosePrice: 111,
    };
    const changedMatrix = buildSimulationReturnMatrix(changedInput);
    const tamperedHash = clone(drawPlan);
    tamperedHash.drawPlanHash = `sha256:${"0".repeat(64)}`;

    assertBlocked(
      materializeSimulationGrossGrowth({
        matrix: changedMatrix,
        drawPlan,
      }),
      "input_matrix_hash_mismatch",
    );
    assertBlocked(
      materializeSimulationGrossGrowth({ matrix, drawPlan: tamperedHash }),
      "input_draw_plan_hash_mismatch",
    );
  });

  it("rejects out-of-range indices and tampered source dates", () => {
    const matrix = growthMatrix();
    const drawPlan = buildPlan(matrix);
    const outOfRange = clone(drawPlan);
    outOfRange.paths[0].draws[0].sourceRowIndex = matrix.matrix.length;
    const wrongDate = clone(drawPlan);
    wrongDate.paths[0].draws[0].serviceDate = "2026-07-12";

    assertBlocked(
      materializeSimulationGrossGrowth({ matrix, drawPlan: outOfRange }),
      "input_draw_plan_shape_invalid",
    );
    assertBlocked(
      materializeSimulationGrossGrowth({ matrix, drawPlan: wrongDate }),
      "input_draw_plan_shape_invalid",
    );
  });

  it("rejects outputs above the explicit memory safety bound", () => {
    const matrix = wideZeroReturnMatrix(1001);
    const drawPlan = buildPlan(matrix, {
      horizon: 1000,
      pathCount: 1,
      expectedBlockLength: 1,
    });
    const result = materializeSimulationGrossGrowth({ matrix, drawPlan });

    assert.equal(result.totalGrowthFactorCells, 1_002_001);
    assertBlocked(result, "growth_output_too_large");
  });

  it("does not resample, aggregate, summarize, persist, or call runtime data", () => {
    const source = [
      "src/lib/simulation-gross-growth-types.ts",
      "src/lib/simulation-gross-growth-validation.ts",
      "src/lib/simulation-gross-growth.ts",
      "src/lib/simulation-stationary-bootstrap-policy.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const matrix = growthMatrix();
    const drawPlan = buildPlan(matrix);
    const result = materializeSimulationGrossGrowth({ matrix, drawPlan });

    assert.equal(
      SIMULATION_GROSS_GROWTH_POLICY.resampling,
      "consume_draw_plan_without_resampling",
    );
    assert.equal(
      SIMULATION_GROSS_GROWTH_POLICY.portfolioAggregation,
      "forbidden",
    );
    assert.doesNotMatch(
      source,
      /Math\.random|createMulberry32|buildStationaryBootstrapDrawPlan|Date\.now|randomBytes|randomUUID/i,
    );
    assert.doesNotMatch(
      source,
      /initial.?wealth|portfolio.?weight|rebalance|cash|fee|tax|transaction.?cost|drawdown|percentile|p10|p50|p90|optimizer|recommendation|ma120/i,
    );
    assert.doesNotMatch(
      source,
      /@\/db|drizzle|neon|server-only|fetch\s*\(|\/api\/|provider|blob|insert\s+into|update\s+\w+\s+set/i,
    );
    assert.doesNotMatch(
      JSON.stringify(result),
      /legacy|owner|user[_-]?id|currentValue|terminalWealth/i,
    );
  });
});

function buildPlan(matrix, overrides = {}) {
  return buildStationaryBootstrapDrawPlan({
    matrix,
    seed: 123_456_789,
    expectedBlockLength: 1,
    horizon: 4,
    pathCount: 2,
    ...overrides,
  });
}

function growthMatrix() {
  return buildSimulationReturnMatrix(growthFixture());
}

function growthFixture() {
  return {
    requestedServiceDates: [
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
    ],
    instruments: [
      instrument("114800", "korea", "KRW"),
      instrument("069500", "korea", "KRW"),
    ],
    priceRows: [
      price("069500", "korea", "KRW", "2026-07-01", 100),
      price("069500", "korea", "KRW", "2026-07-02", 110),
      price("069500", "korea", "KRW", "2026-07-03", 99),
      price("069500", "korea", "KRW", "2026-07-04", 99),
      price("114800", "korea", "KRW", "2026-07-01", 100),
      price("114800", "korea", "KRW", "2026-07-02", 100),
      price("114800", "korea", "KRW", "2026-07-03", 120),
      price("114800", "korea", "KRW", "2026-07-04", 60),
    ],
    fxRows: [],
  };
}

function singleRowMatrix(value) {
  const matrix = buildSimulationReturnMatrix({
    requestedServiceDates: ["2026-07-02", "2026-07-03"],
    instruments: [instrument("069500", "korea", "KRW")],
    priceRows: [
      price("069500", "korea", "KRW", "2026-07-01", 100),
      price("069500", "korea", "KRW", "2026-07-02", 100),
    ],
    fxRows: [],
  });
  const mutable = clone(matrix);
  mutable.matrix[0].cells[0].value = value;
  return mutable;
}

function wideZeroReturnMatrix(instrumentCount) {
  const instruments = Array.from({ length: instrumentCount }, (_, index) => ({
    instrumentKey: `korea|KRW|${String(index).padStart(6, "0")}`,
    market: "korea",
    currency: "KRW",
    ticker: String(index).padStart(6, "0"),
  }));
  const evidence = {
    status: "ready",
    reason: null,
    sourcePriceDate: "2026-07-01",
    priceCarryDays: 0,
    sourceFxDate: null,
    fxCarryDays: null,
  };
  return {
    status: "ready",
    policy: {
      version: "simulation_return_matrix_v1",
      returnKind: "krw_investor_simple_return",
      priceField: "adjusted_close_price_only",
      fxPolicy: "date_specific_usdkrw",
      serviceDatePolicy: "stored_close_evidence_d_plus_1",
      maxPriceCarryDays: 7,
      maxFxCarryDays: 3,
      missingCellPolicy: "preserve_null_without_row_drop_or_zero_fill",
      instrumentMinimum: "none",
      stochasticConsumer: "blocked_when_incomplete",
    },
    requestedServiceDates: ["2026-07-02", "2026-07-03"],
    instruments,
    exclusions: [],
    matrix: [
      {
        previousServiceDate: "2026-07-02",
        serviceDate: "2026-07-03",
        cells: instruments.map(({ instrumentKey }) => ({
          instrumentKey,
          value: 0,
          previous: evidence,
          current: evidence,
        })),
      },
    ],
    summary: {
      requestedInstrumentCount: instrumentCount,
      includedInstrumentCount: instrumentCount,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: 2,
      matrixRowCount: 1,
      totalCellCount: instrumentCount,
      readyCellCount: instrumentCount,
      incompleteCellCount: 0,
      coveragePct: 100,
    },
    sourceSummary: {
      acceptedPriceRows: 0,
      acceptedFxRows: 0,
      ignoredOutOfWindowPriceRows: 0,
      ignoredOutOfWindowFxRows: 0,
    },
    consumerStatus: "matrix_ready",
    blockers: [],
  };
}

function assertFactors(path, expected) {
  assert.equal(path.points.length, expected.length);
  path.points.forEach((point, pointIndex) => {
    point.grossGrowthFactors.forEach((factor, factorIndex) => {
      assert.ok(
        Math.abs(factor.value - expected[pointIndex][factorIndex]) < 1e-12,
        `${pointIndex}/${factorIndex}: ${factor.value}`,
      );
    });
  });
}

function assertBlocked(result, reason) {
  assert.equal(result.status, "blocked");
  assert.deepEqual(result.paths, []);
  assert.ok(
    result.blockers.some((blocker) => blocker.reason === reason),
    JSON.stringify(result.blockers),
  );
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
