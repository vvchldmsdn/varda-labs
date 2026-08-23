import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectLargestMovementContributor } from "../src/lib/home-metrics.ts";

describe("home metrics", () => {
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
