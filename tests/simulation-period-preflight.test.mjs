import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { loadSimulationPeriodPreflight } from "../src/lib/simulation-period-preflight-loader.ts";
import {
  SIMULATION_PERIOD_PREFLIGHT_SCAN_POLICY,
  planSimulationPeriodPreflightScan,
} from "../src/lib/simulation-period-preflight-plan.ts";
import {
  crossMarketSimulationFixture,
  fx,
  price,
} from "./fixtures/simulation-return-matrix.mjs";

describe("Simulation Period Phase 0C read-only preflight", () => {
  it("plans the fixed versioned axis-discovery range", () => {
    const plan = planSimulationPeriodPreflightScan(request());

    assert.equal(plan.status, "queryable");
    assert.deepEqual(plan.queryRange, {
      axisScanDays: 36,
      sourceDateFrom: "2026-06-01",
      sourceDateTo: "2026-07-07",
    });
    assert.equal(plan.requiredPointCount, 3);
    assert.equal(plan.requiresFx, true);
    assert.equal(
      plan.policy.axisScanDaysFormula,
      "ceil((return_step_count_plus_one)*2)+30",
    );
  });

  it("performs one axis scan and one exact Phase 0B coverage read", async () => {
    const fixture = crossMarketSimulationFixture();
    const calls = [];
    const result = await loadSimulationPeriodPreflight(
      repository(fixture, calls),
      request(),
    );

    assert.deepEqual(calls, [
      ["price", "2026-06-01", "2026-07-07", "069500,VOO"],
      ["fx", "2026-06-01", "2026-07-07"],
      ["price", "2026-06-26", "2026-07-07", "069500,VOO"],
      ["fx", "2026-06-30", "2026-07-07"],
    ]);
    assert.equal(result.status, "matrix_ready");
    assert.equal(result.axisStatus, "axis_ready");
    assert.equal(result.matrixStatus, "ready");
    assert.equal(
      result.scenarioVectorReviewStatus,
      "eligible_for_scenario_vector_review",
    );
    assert.equal(result.scan.outcome, "axis_resolved");
    assert.equal(result.scan.automaticRetryPerformed, false);
    assert.deepEqual(result.axis.resolvedServiceDates, [
      "2026-07-04",
      "2026-07-07",
      "2026-07-08",
    ]);
    assert.match(
      result.matrixEvidence?.scenarioUniverseHash ?? "",
      /^sha256:[0-9a-f]{64}$/,
    );
    assert.match(
      result.matrixEvidence?.matrixRequestHash ?? "",
      /^sha256:[0-9a-f]{64}$/,
    );
  });

  it("stops within the fixed scan bound when N plus one points are unavailable", async () => {
    const fixture = {
      priceRows: [price("VOO", "us", "USD", "2026-07-03", 100)],
      fxRows: [fx("2026-07-03", 1_000)],
    };
    const calls = [];
    const result = await loadSimulationPeriodPreflight(
      repository(fixture, calls),
      {
        candidates: [candidate("VOO", "us", "USD", "VOO")],
        endServiceDate: "2026-07-04",
        returnStepCount: 2,
      },
    );

    assert.equal(calls.length, 2);
    assert.equal(result.status, "axis_incomplete");
    assert.equal(result.axisStatus, "axis_incomplete");
    assert.equal(result.matrixStatus, "not_run");
    assert.equal(result.matrixEvidence, null);
    assert.equal(
      result.scan.outcome,
      "insufficient_axis_within_scan_bound",
    );
    assert.equal(result.scan.coverage.status, "not_started");
    assert.equal(result.scan.automaticRetryPerformed, false);
  });

  it("does not start coverage after ambiguous axis source evidence", async () => {
    const fixture = crossMarketSimulationFixture();
    fixture.priceRows.push({ ...fixture.priceRows[0] });
    const calls = [];
    const result = await loadSimulationPeriodPreflight(
      repository(fixture, calls),
      request(),
    );

    assert.equal(calls.length, 2);
    assert.equal(result.status, "axis_blocked");
    assert.equal(result.axisStatus, "axis_blocked");
    assert.equal(result.matrixEvidence, null);
    assert.deepEqual(result.axis.resolvedServiceDates, []);
    assert.ok(
      result.axis.issues.some(
        (issue) => issue.reason === "duplicate_price_date",
      ),
    );
  });

  it("validates the request before any repository method runs", async () => {
    let callCount = 0;
    const result = await loadSimulationPeriodPreflight(
      {
        async loadPriceRows() {
          callCount += 1;
          return [];
        },
        async loadFxRows() {
          callCount += 1;
          return [];
        },
      },
      { ...request(), returnStepCount: 0 },
    );

    assert.equal(callCount, 0);
    assert.equal(result.status, "axis_blocked");
    assert.equal(result.scan.outcome, "request_blocked");
    assert.equal(result.scan.axisDiscovery.status, "not_started");
    assert.ok(
      result.axis.issues.some(
        (issue) => issue.reason === "invalid_return_step_count",
      ),
    );
  });

  it("skips FX in both fixed stages for a KRW-only universe", async () => {
    const fixture = crossMarketSimulationFixture();
    const calls = [];
    const result = await loadSimulationPeriodPreflight(
      repository(fixture, calls),
      {
        candidates: [candidate("069500", "korea", "KRW", "KODEX 200")],
        endServiceDate: "2026-07-08",
        returnStepCount: 2,
      },
    );

    assert.equal(result.status, "matrix_ready");
    assert.deepEqual(
      calls.map((row) => row[0]),
      ["price", "price"],
    );
    assert.equal(result.scan.axisDiscovery.fxRead, false);
  });

  it("hands a missing candidate to Phase 0B instead of dropping it", async () => {
    const fixture = crossMarketSimulationFixture();
    const calls = [];
    const result = await loadSimulationPeriodPreflight(
      repository(fixture, calls),
      {
        candidates: [
          candidate("069500", "korea", "KRW", "KODEX 200"),
          candidate("MISSING", "korea", "KRW", "Missing"),
        ],
        endServiceDate: "2026-07-08",
        returnStepCount: 2,
      },
    );

    assert.equal(result.axisStatus, "axis_ready");
    assert.equal(result.status, "matrix_incomplete");
    assert.equal(result.matrixStatus, "incomplete");
    assert.equal(
      result.scenarioVectorReviewStatus,
      "blocked_until_matrix_ready",
    );
    assert.equal(result.matrixEvidence?.instruments.length, 2);
    assert.equal(
      result.axis.candidates.find((row) => row.ticker === "MISSING")?.status,
      "missing",
    );
    assert.deepEqual(
      calls.map((row) => row[0]),
      ["price", "price"],
    );
  });

  it("keeps adapter output and source free of values, writes, routes, and automatic expansion", async () => {
    const fixture = crossMarketSimulationFixture();
    const result = await loadSimulationPeriodPreflight(
      repository(fixture, []),
      request(),
    );
    const source = [
      "src/lib/simulation-period-preflight-plan.ts",
      "src/lib/simulation-period-preflight-loader.ts",
      "src/db/queries/simulation-return-matrix.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(
      JSON.stringify(result),
      /"adjustedClosePrice":|"usdKrw":|"weightBps":|"quantity":|"currentValue":|"legacyBase44|"ownerUser/i,
    );
    assert.doesNotMatch(
      source,
      /\.insert\(|\.update\(|\.delete\(|\.returning\(|fetch\s*\(|\/api\/|provider|cron|setTimeout|while\s*\(/i,
    );
    assert.match(source, /^import "server-only";/m);
    assert.doesNotMatch(source, /\.select\(\s*\)/);
    assert.equal(SIMULATION_PERIOD_PREFLIGHT_SCAN_POLICY.automaticRetry, "forbidden");
  });
});

function request() {
  return {
    candidates: [
      candidate("069500", "korea", "KRW", "KODEX 200"),
      candidate("VOO", "us", "USD", "VOO"),
    ],
    endServiceDate: "2026-07-08",
    returnStepCount: 2,
  };
}

function candidate(ticker, market, currency, displayName) {
  return { ticker, market, currency, displayName };
}

function repository(fixture, calls) {
  return {
    async loadPriceRows(input) {
      calls.push([
        "price",
        input.sourceDateFrom,
        input.sourceDateTo,
        input.instruments.map((row) => row.ticker).sort().join(","),
      ]);
      const keys = new Set(
        input.instruments.map(
          (row) => `${row.market}|${row.currency}|${row.ticker}`,
        ),
      );
      return fixture.priceRows.filter(
        (row) =>
          keys.has(`${row.market}|${row.currency}|${row.ticker}`) &&
          row.priceDate >= input.sourceDateFrom &&
          row.priceDate <= input.sourceDateTo,
      );
    },
    async loadFxRows(input) {
      calls.push(["fx", input.sourceDateFrom, input.sourceDateTo]);
      return fixture.fxRows.filter(
        (row) =>
          row.rateDate >= input.sourceDateFrom &&
          row.rateDate <= input.sourceDateTo,
      );
    },
  };
}
