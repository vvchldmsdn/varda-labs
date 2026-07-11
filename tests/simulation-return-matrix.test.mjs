import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  SIMULATION_RETURN_MATRIX_POLICY,
  buildSimulationReturnMatrix,
} from "../src/lib/simulation-return-matrix.ts";
import {
  crossMarketSimulationFixture,
  fx,
  instrument,
  price,
} from "./fixtures/simulation-return-matrix.mjs";

describe("Simulation Validation return matrix Phase 0A", () => {
  it("builds the requested rectangular KRW return matrix across KR and US holidays", () => {
    const result = buildSimulationReturnMatrix(crossMarketSimulationFixture());

    assert.equal(result.status, "ready");
    assert.deepEqual(result.requestedServiceDates, [
      "2026-07-04",
      "2026-07-07",
      "2026-07-08",
    ]);
    assert.deepEqual(
      result.instruments.map((row) => row.instrumentKey),
      ["korea|KRW|069500", "us|USD|VOO"],
    );
    assert.deepEqual(
      result.matrix.map((row) => [
        row.previousServiceDate,
        row.serviceDate,
        row.cells.length,
      ]),
      [
        ["2026-07-04", "2026-07-07", 2],
        ["2026-07-07", "2026-07-08", 2],
      ],
    );
    assert.deepEqual(result.summary, {
      requestedInstrumentCount: 2,
      includedInstrumentCount: 2,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: 3,
      matrixRowCount: 2,
      totalCellCount: 4,
      readyCellCount: 4,
      incompleteCellCount: 0,
      coveragePct: 100,
    });
    assert.equal(result.consumerStatus, "matrix_ready");
    assert.deepEqual(result.blockers, []);
  });

  it("includes date-specific USD/KRW movement when the USD close is unchanged", () => {
    const result = buildSimulationReturnMatrix(crossMarketSimulationFixture());
    const usdReturns = result.matrix.map(
      (row) =>
        row.cells.find((cell) => cell.instrumentKey === "us|USD|VOO")
          ?.value ?? Number.NaN,
    );
    const firstUsd = result.matrix[0].cells.find(
      (cell) => cell.instrumentKey === "us|USD|VOO",
    );

    assertApprox(usdReturns[0], 1010 / 1000 - 1);
    assertApprox(usdReturns[1], 1020 / 1010 - 1);
    assert.deepEqual(firstUsd?.previous, {
      status: "ready",
      reason: null,
      sourcePriceDate: "2026-07-02",
      priceCarryDays: 1,
      sourceFxDate: "2026-07-03",
      fxCarryDays: 0,
    });
  });

  it("preserves incomplete cells and requested rows instead of intersecting or zero-filling", () => {
    const fixture = crossMarketSimulationFixture();
    fixture.priceRows = fixture.priceRows.filter(
      (row) => !(row.ticker === "VOO" && row.priceDate === "2026-07-02"),
    );
    const result = buildSimulationReturnMatrix(fixture);
    const firstUsd = result.matrix[0].cells.find(
      (cell) => cell.instrumentKey === "us|USD|VOO",
    );

    assert.equal(result.status, "incomplete");
    assert.equal(result.matrix.length, 2);
    assert.ok(result.matrix.every((row) => row.cells.length === 2));
    assert.equal(firstUsd?.value, null);
    assert.equal(firstUsd?.previous.reason, "missing_price");
    assert.equal(result.summary.totalCellCount, 4);
    assert.equal(result.summary.readyCellCount, 3);
    assert.equal(result.consumerStatus, "blocked_incomplete_matrix");
  });

  it("applies the seven-day price and three-day FX carry bounds", () => {
    const stalePrice = buildSimulationReturnMatrix({
      requestedServiceDates: ["2026-07-04", "2026-07-12"],
      instruments: [instrument("069500", "korea", "KRW")],
      priceRows: [price("069500", "korea", "KRW", "2026-07-03", 100)],
      fxRows: [],
    });
    const staleFx = buildSimulationReturnMatrix({
      requestedServiceDates: ["2026-07-06", "2026-07-10"],
      instruments: [instrument("VOO", "us", "USD")],
      priceRows: [
        price("VOO", "us", "USD", "2026-07-05", 100),
        price("VOO", "us", "USD", "2026-07-09", 100),
      ],
      fxRows: [fx("2026-07-05", 1000)],
    });

    assert.equal(stalePrice.status, "incomplete");
    assert.equal(stalePrice.matrix[0].cells[0].current.reason, "stale_price");
    assert.equal(staleFx.status, "incomplete");
    assert.equal(staleFx.matrix[0].cells[0].current.reason, "stale_fx");
  });

  it("does not look ahead to future price or FX evidence", () => {
    const futurePrice = buildSimulationReturnMatrix({
      requestedServiceDates: ["2026-07-04", "2026-07-07"],
      instruments: [instrument("069500", "korea", "KRW")],
      priceRows: [price("069500", "korea", "KRW", "2026-07-07", 100)],
      fxRows: [],
    });
    const futureFx = buildSimulationReturnMatrix({
      requestedServiceDates: ["2026-07-04", "2026-07-07"],
      instruments: [instrument("VOO", "us", "USD")],
      priceRows: [
        price("VOO", "us", "USD", "2026-07-03", 100),
        price("VOO", "us", "USD", "2026-07-06", 100),
      ],
      fxRows: [fx("2026-07-07", 1000)],
    });

    assert.equal(futurePrice.matrix[0].cells[0].previous.reason, "missing_price");
    assert.equal(futurePrice.sourceSummary.ignoredOutOfWindowPriceRows, 1);
    assert.equal(futureFx.matrix[0].cells[0].previous.reason, "missing_fx");
    assert.equal(futureFx.sourceSummary.ignoredOutOfWindowFxRows, 1);
  });

  it("hard-blocks duplicate price and FX dates", () => {
    const duplicatePrice = crossMarketSimulationFixture();
    duplicatePrice.priceRows.push({ ...duplicatePrice.priceRows[0] });
    const duplicateFx = crossMarketSimulationFixture();
    duplicateFx.fxRows.push({ ...duplicateFx.fxRows[0] });

    const priceResult = buildSimulationReturnMatrix(duplicatePrice);
    const fxResult = buildSimulationReturnMatrix(duplicateFx);

    assertBlocked(priceResult, "duplicate_price_date");
    assertBlocked(fxResult, "duplicate_fx_date");
  });

  it("hard-blocks raw-close mixing and invalid or non-positive values", () => {
    const rawClose = crossMarketSimulationFixture();
    rawClose.priceRows[0] = { ...rawClose.priceRows[0], closePrice: 100 };
    const invalidPrice = crossMarketSimulationFixture();
    invalidPrice.priceRows[0] = {
      ...invalidPrice.priceRows[0],
      adjustedClosePrice: 0,
    };
    const invalidFx = crossMarketSimulationFixture();
    invalidFx.fxRows[0] = { ...invalidFx.fxRows[0], usdKrw: -1 };
    const failedFx = crossMarketSimulationFixture();
    failedFx.fxRows[0] = { ...failedFx.fxRows[0], status: "empty" };

    assertBlocked(
      buildSimulationReturnMatrix(rawClose),
      "raw_close_field_forbidden",
    );
    assertBlocked(
      buildSimulationReturnMatrix(invalidPrice),
      "invalid_adjusted_close",
    );
    assertBlocked(buildSimulationReturnMatrix(invalidFx), "invalid_fx_rate");
    assertBlocked(buildSimulationReturnMatrix(failedFx), "invalid_fx_status");
  });

  it("keeps unavailable KRX gold and managed-product history as explicit exclusions", () => {
    const fixture = crossMarketSimulationFixture();
    fixture.instruments.push(
      instrument(null, "krx_gold", "KRW", "unavailable"),
      instrument(null, "managed_product", "KRW", "unavailable"),
    );
    const result = buildSimulationReturnMatrix(fixture);

    assert.equal(result.status, "incomplete");
    assert.equal(result.matrix.length, 2);
    assert.equal(result.summary.requestedInstrumentCount, 4);
    assert.equal(result.summary.includedInstrumentCount, 2);
    assert.equal(result.summary.excludedInstrumentCount, 2);
    assert.ok(
      result.exclusions.every(
        (row) => row.reason === "instrument_history_unavailable",
      ),
    );
    assert.equal(result.consumerStatus, "blocked_incomplete_matrix");
  });

  it("allows one instrument and preserves the exact requested date window", () => {
    const result = buildSimulationReturnMatrix({
      requestedServiceDates: ["2026-07-04", "2026-07-07"],
      instruments: [instrument("069500", "korea", "KRW")],
      priceRows: [
        price("069500", "korea", "KRW", "2026-07-03", 100),
        price("069500", "korea", "KRW", "2026-07-06", 101),
      ],
      fxRows: [],
    });

    assert.equal(result.status, "ready");
    assert.equal(result.instruments.length, 1);
    assert.deepEqual(result.requestedServiceDates, [
      "2026-07-04",
      "2026-07-07",
    ]);
    assert.equal(result.matrix.length, 1);
    assert.equal(result.matrix[0].cells.length, 1);
  });

  it("fails closed for malformed, duplicate, or unsorted service dates", () => {
    const fixture = crossMarketSimulationFixture();
    const variants = [
      { dates: ["2026-07-04"], blocker: "insufficient_service_dates" },
      {
        dates: ["2026-07-04", "2026-07-04"],
        blocker: "duplicate_service_date",
      },
      {
        dates: ["2026-07-07", "2026-07-04"],
        blocker: "unsorted_service_dates",
      },
      {
        dates: ["2026-07-04", "2026-02-30"],
        blocker: "invalid_service_date",
      },
    ];

    for (const variant of variants) {
      const result = buildSimulationReturnMatrix({
        ...fixture,
        requestedServiceDates: variant.dates,
      });
      assertBlocked(result, variant.blocker);
    }
  });

  it("is independent of instrument and source-row order", () => {
    const fixture = crossMarketSimulationFixture();
    const reversed = buildSimulationReturnMatrix({
      ...fixture,
      instruments: [...fixture.instruments].reverse(),
      priceRows: [...fixture.priceRows].reverse(),
      fxRows: [...fixture.fxRows].reverse(),
    });

    assert.deepEqual(reversed, buildSimulationReturnMatrix(fixture));
  });

  it("exposes no internal ids and imports no risk math, runtime, or stochastic engine", () => {
    const fixture = crossMarketSimulationFixture();
    fixture.instruments = fixture.instruments.map((row, index) => ({
      ...row,
      id: `internal-${index}`,
      legacyBase44Id: `legacy-${index}`,
      ownerUserId: `owner-${index}`,
    }));
    fixture.priceRows = fixture.priceRows.map((row) => ({
      ...row,
      id: "price-internal",
      legacyBase44Id: "price-legacy",
    }));
    const result = buildSimulationReturnMatrix(fixture);
    const source = [
      "src/lib/simulation-return-matrix.ts",
      "src/lib/simulation-return-matrix-normalization.ts",
      "src/lib/simulation-return-matrix-types.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    assert.doesNotMatch(
      JSON.stringify(result),
      /internal|legacy|owner|user[_-]?id|created[_-]?by/i,
    );
    assert.doesNotMatch(
      source,
      /portfolio-risk-input|portfolio-risk-statistics|portfolio-risk\.ts|sharpe|covariance|optimizer|Math\.random|seed|monte.?carlo|bootstrap/i,
    );
    assert.doesNotMatch(
      source,
      /@\/db|drizzle|neon|server-only|fetch\s*\(|\/api\/|target-policy-resolver|isa-v1|ma120|additional-contribution-ma120/i,
    );
    assert.equal(SIMULATION_RETURN_MATRIX_POLICY.instrumentMinimum, "none");
  });
});

function assertBlocked(result, reason) {
  assert.equal(result.status, "blocked");
  assert.equal(result.matrix.length, 0);
  assert.ok(
    result.blockers.some((blocker) => blocker.reason === reason),
    JSON.stringify(result.blockers),
  );
  assert.equal(result.consumerStatus, "blocked_incomplete_matrix");
}

function assertApprox(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
}
