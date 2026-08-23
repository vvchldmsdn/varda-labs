import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateFxAwareSnapshotMovementKrw,
  calculateFxAwarePositionMovementKrw,
  convertToKrw,
  diffDays,
  normalizeTicker,
  resolveKrwFxRate,
  percentOrNull,
  sumBy,
  toNumber,
  uniqueStrings,
} from "../src/lib/portfolio-math.ts";

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

describe("portfolio math helpers", () => {
  it("normalizes tickers without turning empty input into a value", () => {
    assert.equal(normalizeTicker(" voo "), "VOO");
    assert.equal(normalizeTicker(""), null);
    assert.equal(normalizeTicker(undefined), null);
  });

  it("converts USD values to KRW while leaving local values unchanged", () => {
    assert.equal(convertToKrw(100, "USD", 1350), 135000);
    assert.equal(convertToKrw(100, "KRW", 1350), 100);
  });

  it("does not silently treat unsupported foreign currencies as KRW", () => {
    assert.equal(convertToKrw(100, "JPY", 1350), null);
    assert.deepEqual(resolveKrwFxRate("JPY", 1350), {
      ok: false,
      currency: "JPY",
      rate: null,
      requiresFx: true,
      reason: "unsupported_currency",
    });
    assert.deepEqual(resolveKrwFxRate("USD", 0), {
      ok: false,
      currency: "USD",
      rate: null,
      requiresFx: true,
      reason: "missing_usd_krw_rate",
    });
  });

  it("includes USD/KRW movement in KRW daily value changes", () => {
    const movement = calculateFxAwarePositionMovementKrw({
      marketExposedQuantity: 10,
      previousPrice: 100,
      currentPrice: 110,
      previousFxRate: 1200,
      currentFxRate: 1300,
      previousMarketValueKrw: 1_200_000,
    });

    assert.equal(movement.currentValueKrw, 1_430_000);
    assert.equal(movement.previousValueKrw, 1_200_000);
    assert.equal(movement.changeKrw, 230_000);
    assert.equal(movement.priceChangeKrw, 120_000);
    assert.equal(movement.fxChangeKrw, 110_000);
  });

  it("does not expose a fixed KRW fractional balance to price or FX movement", () => {
    const movement = calculateFxAwarePositionMovementKrw({
      marketExposedQuantity: 4,
      previousPrice: 704.77,
      currentPrice: 704.77,
      previousFxRate: 1394.706577,
      currentFxRate: 1385.741836,
      fixedKrwValue: 433_748,
      previousMarketValueKrw: 4_365_537.417089,
    });

    assertClose(movement.currentValueKrw, 4_340_265.095031);
    assertClose(movement.changeKrw, -25_272.322058);
    assertClose(movement.priceChangeKrw, 0);
    assertClose(movement.fxChangeKrw, -25_272.322058);
  });

  it("keeps a carried fractional quantity exposed during historical backfill", () => {
    const movement = calculateFxAwarePositionMovementKrw({
      marketExposedQuantity: 4.434_011_49,
      previousPrice: 707.82,
      currentPrice: 701.01,
      previousFxRate: 1411.930856,
      currentFxRate: 1395.12,
      previousMarketValueKrw: 4_431_319.593976,
    });

    assertClose(movement.currentValueKrw, 4_336_432.514841, 0.01);
    assertClose(movement.changeKrw, -94_887.079135, 0.01);
    assertClose(
      movement.changeKrw,
      movement.priceChangeKrw + movement.fxChangeKrw,
      0.01,
    );
  });

  it("separates a dashboard snapshot FX loss from unchanged USD price", () => {
    const movement = calculateFxAwareSnapshotMovementKrw({
      quantity: 10,
      previousPrice: 100,
      currentPrice: 100,
      previousFxRate: 1531.722979,
      currentFxRate: 1516.89994,
      previousValueKrw: 1_531_722.979,
      currentValueKrw: 1_516_899.94,
    });

    assertClose(movement.priceChangeKrw, 0);
    assertClose(movement.fxChangeKrw, -14_823.039);
    assertClose(movement.changeKrw, -14_823.039);
  });

  it("keeps dashboard snapshot movement equal to price plus FX effects", () => {
    const movement = calculateFxAwareSnapshotMovementKrw({
      quantity: 10,
      previousPrice: 100,
      currentPrice: 105,
      previousFxRate: 1531.722979,
      currentFxRate: 1516.89994,
      previousValueKrw: 1_531_722.979,
      currentValueKrw: 1_592_744.937,
    });

    assertClose(movement.priceChangeKrw, 76_586.14895);
    assertClose(movement.fxChangeKrw, -15_564.19095);
    assertClose(movement.changeKrw, 61_021.958);
    assertClose(
      movement.changeKrw,
      movement.priceChangeKrw + movement.fxChangeKrw,
    );
  });

  it("returns percentage only when denominator is positive", () => {
    assert.equal(percentOrNull(25, 200), 12.5);
    assert.equal(percentOrNull(25, 0), null);
    assert.equal(percentOrNull(null, 200), null);
  });

  it("parses finite numeric input and rejects empty or non-finite values", () => {
    assert.equal(toNumber("123.45"), 123.45);
    assert.equal(toNumber(0), 0);
    assert.equal(toNumber(""), null);
    assert.equal(toNumber("not-a-number"), null);
    assert.equal(toNumber(Infinity), null);
  });

  it("computes date deltas and treats invalid dates as zero distance", () => {
    assert.equal(diffDays("2026-07-08", "2026-07-01"), 7);
    assert.equal(diffDays("2026-07-01", "2026-07-08"), -7);
    assert.equal(diffDays("bad-date", "2026-07-08"), 0);
  });

  it("deduplicates strings and sums nullable selector values", () => {
    assert.deepEqual(uniqueStrings(["isa", "isa", "irp"]), ["isa", "irp"]);
    assert.equal(
      sumBy(
        [{ amount: 10 }, { amount: null }, { amount: undefined }, { amount: 5 }],
        (row) => row.amount,
      ),
      15,
    );
  });
});
