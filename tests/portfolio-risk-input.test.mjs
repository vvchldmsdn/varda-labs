import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapRiskEvidenceDateToServiceDate } from "../src/lib/portfolio-risk-calendar.ts";
import { buildPortfolioRiskInput } from "../src/lib/portfolio-risk-input.ts";
import {
  crossMarketRiskFixture,
  duplicateFxCarryFixture,
  fx,
} from "./fixtures/portfolio-risk-input.mjs";

const TWO_RETURN_POLICY = {
  requestedReturnObservations: 2,
  maxPriceCarryDays: 7,
  maxFxCarryDays: 3,
  minimumReturnCoveragePct: 80,
  minimumInstruments: 2,
};

function assertClose(actual, expected, tolerance = 1e-12) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe("portfolio risk input normalization", () => {
  it("treats stored close dates as evidence without consulting snapshot holidays", () => {
    assert.equal(
      mapRiskEvidenceDateToServiceDate("2022-12-26"),
      "2022-12-27",
    );
    assert.equal(
      mapRiskEvidenceDateToServiceDate("2023-01-02"),
      "2023-01-03",
    );
    assert.equal(
      mapRiskEvidenceDateToServiceDate("2025-02-28"),
      "2025-03-01",
    );
  });

  it("uses the union calendar and bounded prior carries across markets", () => {
    const result = buildPortfolioRiskInput({
      ...crossMarketRiskFixture(),
      policy: TWO_RETURN_POLICY,
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(result.selectedServiceDates, [
      "2026-07-04",
      "2026-07-07",
      "2026-07-08",
    ]);
    assert.equal(result.usableReturnObservations, 2);
    assert.equal(result.returnCoveragePct, 100);
    assert.equal(result.valueRows[0].observations[1].priceCarryDays, 1);
    assert.equal(result.valueRows[0].observations[1].fxCarryDays, 0);
  });

  it("includes date-specific USD/KRW movement in USD holding returns", () => {
    const result = buildPortfolioRiskInput({
      ...crossMarketRiskFixture(),
      policy: TWO_RETURN_POLICY,
    });
    const usdReturns = result.returnRows.map(
      (row) =>
        row.returns.find(
          (value) => value.instrumentKey === "us|USD|VOO",
        )?.value ?? Number.NaN,
    );

    assertClose(usdReturns[0], 0.01);
    assertClose(usdReturns[1], 1020 / 1010 - 1);
  });

  it("aggregates identical instruments across accounts before risk math", () => {
    const fixture = crossMarketRiskFixture();
    fixture.holdings.push({
      ...fixture.holdings[1],
      account: "isa",
      quantity: 2,
    });
    const result = buildPortfolioRiskInput({
      ...fixture,
      policy: TWO_RETURN_POLICY,
    });
    const voo = result.instruments.find(
      (instrument) => instrument.instrumentKey === "us|USD|VOO",
    );

    assert.equal(result.instruments.length, 2);
    assert.equal(voo?.quantity, 3);
    assert.deepEqual(voo?.accounts, ["brokerage", "isa"]);
  });

  it("blocks equal-valued FX duplicates inside the selected window", () => {
    const fixture = crossMarketRiskFixture();
    fixture.fxRows.push(fx("2026-07-06", 1010));
    const result = buildPortfolioRiskInput({
      ...fixture,
      policy: TWO_RETURN_POLICY,
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, [
      { reason: "duplicate_fx_date", dates: ["2026-07-06"] },
    ]);
    assert.equal(result.valueRows.length, 0);
    assert.equal(result.returnRows.length, 0);
  });

  it("blocks duplicate price dates for a selected instrument", () => {
    const fixture = crossMarketRiskFixture();
    fixture.priceRows.push({ ...fixture.priceRows[1] });
    const result = buildPortfolioRiskInput({
      ...fixture,
      policy: TWO_RETURN_POLICY,
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, [
      {
        reason: "duplicate_price_date",
        instrumentKey: "korea|KRW|069500",
        dates: ["2026-07-06"],
      },
    ]);
  });

  it("blocks duplicates in the first observation's FX carry range", () => {
    const result = buildPortfolioRiskInput({
      ...duplicateFxCarryFixture("2026-07-02"),
      policy: TWO_RETURN_POLICY,
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, [
      { reason: "duplicate_fx_date", dates: ["2026-07-02"] },
    ]);
  });

  it("does not block an FX duplicate outside the selected carry range", () => {
    const result = buildPortfolioRiskInput({
      ...duplicateFxCarryFixture("2026-06-29"),
      policy: TWO_RETURN_POLICY,
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(result.blockers, []);
    assert.equal(result.returnRows.length, 2);
  });

  it("never looks ahead to a future FX observation", () => {
    const fixture = crossMarketRiskFixture();
    fixture.fxRows = [fx("2026-07-08", 1100)];
    const result = buildPortfolioRiskInput({
      ...fixture,
      policy: TWO_RETURN_POLICY,
    });

    assert.equal(result.status, "insufficient_coverage");
    assert.equal(result.returnRows.length, 0);
    assert.ok(
      result.valueRows.every((row) =>
        row.missing.some(
          (missing) =>
            missing.instrumentKey === "us|USD|VOO" &&
            missing.reason === "missing_fx",
        ),
      ),
    );
  });
});
