import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_PERIOD_REQUEST_POLICY,
  resolveSimulationPeriodRequest,
} from "../src/lib/simulation-period-request-resolver.ts";
import {
  crossMarketSimulationFixture,
  fx,
  price,
} from "./fixtures/simulation-return-matrix.mjs";

describe("Simulation Period Request Resolver Phase 0C", () => {
  it("resolves the KR and US observation union without intersecting histories", () => {
    const result = resolveSimulationPeriodRequest(crossMarketRequest());

    assert.equal(result.status, "ready");
    assert.equal(result.axisStatus, "resolved");
    assert.equal(result.phase0BStatus, "eligible_for_evidence_review");
    assert.deepEqual(result.resolvedServiceDates, [
      "2026-07-04",
      "2026-07-07",
      "2026-07-08",
    ]);
    assert.deepEqual(result.axisSources, {
      acceptedPriceObservationCount: 6,
      acceptedFxObservationCount: 3,
      priceAxisPointCount: 4,
      fxAxisPointCount: 3,
      unionAxisPointCount: 4,
      ignoredExternalPriceRowCount: 0,
      ignoredFuturePriceRowCount: 0,
      ignoredFutureFxRowCount: 0,
      ignoredNotRequiredFxRowCount: 0,
    });
    assert.deepEqual(
      result.candidates.map((row) => [
        row.instrumentKey,
        row.status,
        row.observationCount,
      ]),
      [
        ["korea|KRW|069500", "observed", 3],
        ["us|USD|VOO", "observed", 3],
      ],
    );
    assert.deepEqual(result.issues, []);
  });

  it("preserves a USD FX-only service date in the resolved axis", () => {
    const result = resolveSimulationPeriodRequest({
      candidates: [candidate("VOO", "us", "USD", "VOO")],
      endServiceDate: "2026-07-04",
      returnStepCount: 2,
      priceRows: [
        price("VOO", "us", "USD", "2026-07-01", 100),
        price("VOO", "us", "USD", "2026-07-03", 101),
      ],
      fxRows: [
        fx("2026-07-01", 1_000),
        fx("2026-07-02", 1_010),
        fx("2026-07-03", 1_020),
      ],
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(result.resolvedServiceDates, [
      "2026-07-02",
      "2026-07-03",
      "2026-07-04",
    ]);
    assert.equal(result.request.returnStepCount, 2);
    assert.equal(result.request.requiredPointCount, 3);
  });

  it("fails closed for an unobserved exact endpoint without rolling back", () => {
    const input = crossMarketRequest();
    const result = resolveSimulationPeriodRequest({
      ...input,
      endServiceDate: "2026-07-06",
      returnStepCount: 1,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.axisStatus, "unresolved");
    assert.equal(result.endpoint.requestedEndServiceDate, "2026-07-06");
    assert.equal(result.endpoint.resolvedEndServiceDate, null);
    assert.equal(
      result.endpoint.nearestPriorObservedServiceDate,
      "2026-07-04",
    );
    assert.deepEqual(result.resolvedServiceDates, []);
    assertIssue(result, "end_service_date_not_observed", "blocked");
  });

  it("does not shorten a period with fewer than N plus one axis points", () => {
    const result = resolveSimulationPeriodRequest({
      ...crossMarketRequest(),
      returnStepCount: 4,
    });

    assert.equal(result.status, "incomplete");
    assert.equal(result.axisStatus, "unresolved");
    assert.equal(result.phase0BStatus, "blocked");
    assert.equal(result.request.requiredPointCount, 5);
    assert.equal(result.axisSources.unionAxisPointCount, 4);
    assert.deepEqual(result.resolvedServiceDates, []);
    assertIssue(result, "insufficient_axis_points", "incomplete");
  });

  it("preserves a candidate with no price evidence instead of dropping it", () => {
    const fixture = crossMarketSimulationFixture();
    const result = resolveSimulationPeriodRequest({
      candidates: [
        candidate("069500", "korea", "KRW", "KODEX 200"),
        candidate("MISSING", "korea", "KRW", "Missing candidate"),
      ],
      endServiceDate: "2026-07-08",
      returnStepCount: 2,
      priceRows: fixture.priceRows.filter((row) => row.ticker === "069500"),
      fxRows: fixture.fxRows,
    });
    const missing = result.candidates.find((row) => row.ticker === "MISSING");

    assert.equal(result.status, "incomplete");
    assert.equal(result.axisStatus, "resolved");
    assert.equal(result.phase0BStatus, "eligible_for_evidence_review");
    assert.equal(result.candidates.length, 2);
    assert.equal(missing?.status, "missing");
    assert.equal(missing?.observationCount, 0);
    assertIssue(result, "missing_candidate_price", "incomplete");
    assert.deepEqual(result.resolvedServiceDates, [
      "2026-07-04",
      "2026-07-07",
      "2026-07-08",
    ]);
  });

  it("blocks duplicate price and FX evidence instead of selecting a row", () => {
    const priceInput = crossMarketRequest();
    priceInput.priceRows.push({ ...priceInput.priceRows[0] });
    const fxInput = crossMarketRequest();
    fxInput.fxRows.push({ ...fxInput.fxRows[0] });

    const priceResult = resolveSimulationPeriodRequest(priceInput);
    const fxResult = resolveSimulationPeriodRequest(fxInput);

    assert.equal(priceResult.status, "blocked");
    assert.equal(priceResult.axisStatus, "unresolved");
    assert.equal(priceResult.phase0BStatus, "blocked");
    assert.deepEqual(priceResult.resolvedServiceDates, []);
    assertIssue(priceResult, "duplicate_price_date", "blocked");
    assert.equal(fxResult.status, "blocked");
    assert.deepEqual(fxResult.resolvedServiceDates, []);
    assertIssue(fxResult, "duplicate_fx_date", "blocked");
  });

  it("ignores future observations and remains independent of input row order", () => {
    const input = crossMarketRequest();
    const baseline = resolveSimulationPeriodRequest(input);
    const future = resolveSimulationPeriodRequest({
      ...input,
      candidates: [...input.candidates].reverse(),
      priceRows: [
        price("VOO", "us", "USD", "2026-07-20", 0),
        ...input.priceRows.slice().reverse(),
      ],
      fxRows: [fx("2026-07-20", -1, "empty"), ...input.fxRows.slice().reverse()],
    });

    assert.deepEqual(future.resolvedServiceDates, baseline.resolvedServiceDates);
    assert.deepEqual(future.candidates, baseline.candidates);
    assert.deepEqual(future.issues, baseline.issues);
    assert.equal(future.axisSources.ignoredFuturePriceRowCount, 1);
    assert.equal(future.axisSources.ignoredFutureFxRowCount, 1);
  });

  it("rejects malformed requests and candidate universes before resolution", () => {
    const variants = [
      {
        input: { ...crossMarketRequest(), endServiceDate: "2026-02-30" },
        reason: "invalid_end_service_date",
      },
      {
        input: { ...crossMarketRequest(), returnStepCount: 0 },
        reason: "invalid_return_step_count",
      },
      {
        input: { ...crossMarketRequest(), returnStepCount: 10_001 },
        reason: "invalid_return_step_count",
      },
      {
        input: { ...crossMarketRequest(), candidates: [] },
        reason: "empty_candidate_universe",
      },
      {
        input: {
          ...crossMarketRequest(),
          candidates: [candidate("VOO", "us", "EUR", "Unsupported")],
        },
        reason: "unsupported_candidate_currency",
      },
      {
        input: {
          ...crossMarketRequest(),
          candidates: [
            candidate("VOO", "us", "USD", "VOO"),
            candidate("voo", "US", "usd", "Duplicate"),
          ],
        },
        reason: "duplicate_candidate",
      },
    ];

    for (const variant of variants) {
      const result = resolveSimulationPeriodRequest(variant.input);
      assert.equal(result.status, "blocked");
      assert.equal(result.axisStatus, "unresolved");
      assertIssue(result, variant.reason, "blocked");
    }
  });

  it("blocks invalid in-window source evidence and raw-close mixing", () => {
    const invalidPrice = crossMarketRequest();
    invalidPrice.priceRows[0] = {
      ...invalidPrice.priceRows[0],
      adjustedClosePrice: 0,
    };
    const rawClose = crossMarketRequest();
    rawClose.priceRows[0] = { ...rawClose.priceRows[0], closePrice: 100 };
    const invalidFx = crossMarketRequest();
    invalidFx.fxRows[0] = { ...invalidFx.fxRows[0], status: "empty" };

    assertIssue(
      resolveSimulationPeriodRequest(invalidPrice),
      "invalid_adjusted_close",
      "blocked",
    );
    assertIssue(
      resolveSimulationPeriodRequest(rawClose),
      "raw_close_field_forbidden",
      "blocked",
    );
    assertIssue(
      resolveSimulationPeriodRequest(invalidFx),
      "invalid_fx_status",
      "blocked",
    );
  });

  it("keeps the pure output and implementation free of values, weights, I/O, and hidden defaults", () => {
    const input = crossMarketRequest();
    input.priceRows = input.priceRows.map((row) => ({
      ...row,
      id: "private-price-id",
      legacyBase44Id: "legacy-price-id",
      source: "provider-private",
    }));
    input.fxRows = input.fxRows.map((row) => ({
      ...row,
      id: "private-fx-id",
      legacyBase44Id: "legacy-fx-id",
      source: "provider-private",
    }));
    const result = resolveSimulationPeriodRequest(input);
    const source = [
      "src/lib/simulation-period-request-types.ts",
      "src/lib/simulation-period-request-normalization.ts",
      "src/lib/simulation-period-request-resolver.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(
      JSON.stringify(result),
      /private-price|private-fx|legacyBase44|adjustedClosePrice|usdKrw|weightBps|quantity|currentValue/i,
    );
    assert.doesNotMatch(
      source,
      /@\/db|drizzle|neon|server-only|fetch\s*\(|\/api\/|Math\.random|isa-v1|equal.?weight|current.?holding|target-policy-resolver/i,
    );
    assert.equal(
      SIMULATION_PERIOD_REQUEST_POLICY.calendarDayEnumeration,
      "forbidden",
    );
    assert.equal(
      SIMULATION_PERIOD_REQUEST_POLICY.instrumentIntersection,
      "forbidden",
    );
  });
});

function crossMarketRequest() {
  const fixture = crossMarketSimulationFixture();
  return {
    candidates: [
      candidate("069500", "korea", "KRW", "KODEX 200"),
      candidate("VOO", "us", "USD", "VOO"),
    ],
    endServiceDate: "2026-07-08",
    returnStepCount: 2,
    priceRows: fixture.priceRows,
    fxRows: fixture.fxRows,
  };
}

function candidate(ticker, market, currency, displayName) {
  return { ticker, market, currency, displayName };
}

function assertIssue(result, reason, severity) {
  assert.ok(
    result.issues.some(
      (issue) => issue.reason === reason && issue.severity === severity,
    ),
    JSON.stringify(result.issues),
  );
}
