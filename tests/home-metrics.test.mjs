import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { availableHoldingValueKrw, selectLargestMovementContributor } from "../src/lib/home-metrics.ts";

describe("home metrics", () => {
  it("distinguishes missing quote and FX evidence from a confirmed zero valuation", () => {
    const holding = { currentPrice: 701.26, currency: "USD", valueKrw: 835_291, quantity: 0.896567 };
    const original = structuredClone(holding);
    assert.equal(availableHoldingValueKrw(holding, 1328), 835_291);
    assert.equal(availableHoldingValueKrw({ ...holding, currentPrice: 0, valueKrw: 0 }, 1328), null);
    assert.equal(availableHoldingValueKrw({ ...holding, valueKrw: 0 }, 0), null);
    assert.equal(availableHoldingValueKrw({ ...holding, currency: "EUR" }, 1328), null);
    assert.equal(availableHoldingValueKrw({ ...holding, valueKrw: NaN }, 1328), null);
    assert.equal(availableHoldingValueKrw({ ...holding, valueKrw: 0, quantity: 0 }, 1328), 0);
    assert.equal(availableHoldingValueKrw({ ...holding, currency: "KRW" }, 0), 835_291);
    assert.deepEqual(holding, original);
  });
  it("selects the largest absolute contribution on an all-negative day", () => {
    const holdings = [
      { name: "KODEX 200", dailyChangeKrw: 0 },
      { name: "QQQ", dailyChangeKrw: -748 },
      { name: "SCHD", dailyChangeKrw: -3_308 },
      { name: "VOO", dailyChangeKrw: -5_876 },
    ];

    assert.equal(selectLargestMovementContributor(holdings)?.name, "VOO");
  });

  it("returns no contributor when every holding is unchanged", () => {
    assert.equal(
      selectLargestMovementContributor([
        { name: "KODEX 200", dailyChangeKrw: 0 },
        { name: "VOO", dailyChangeKrw: 0 },
        { name: "금현물", dailyChangeKrw: null },
      ]),
      null,
    );
  });

  it("ignores sub-won calculation residue that is displayed as zero", () => {
    assert.equal(
      selectLargestMovementContributor([
        { name: "KODEX 200", dailyChangeKrw: 0.000_001 },
        { name: "VOO", dailyChangeKrw: -0.49 },
      ]),
      null,
    );
  });
});
