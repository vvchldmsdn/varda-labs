import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  convertToKrw,
  diffDays,
  normalizeTicker,
  percentOrNull,
  sumBy,
  toNumber,
  uniqueStrings,
} from "../src/lib/portfolio-math.ts";

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
