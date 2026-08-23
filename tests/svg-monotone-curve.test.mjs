import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMonotoneCurvePath } from "../src/lib/svg-monotone-curve.ts";

describe("svg monotone curve", () => {
  it("uses cubic segments for a multi-point series", () => {
    const path = buildMonotoneCurvePath([
      { x: 0, y: 10 },
      { x: 10, y: 4 },
      { x: 20, y: 8 },
      { x: 30, y: 2 },
    ]);

    assert.match(path, /^M0\.00,10\.00 C/);
    assert.equal((path.match(/C/g) ?? []).length, 3);
    assert.doesNotMatch(path, /NaN|Infinity/);
  });

  it("falls back to a line for insufficient or invalid x coordinates", () => {
    assert.equal(
      buildMonotoneCurvePath([{ x: 0, y: 1 }, { x: 5, y: 3 }]),
      "M0.00,1.00 L5.00,3.00",
    );
    assert.equal(
      buildMonotoneCurvePath([{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 3, y: 4 }]),
      "M0.00,1.00 L0.00,2.00 L3.00,4.00",
    );
  });

  it("keeps flat segments finite", () => {
    const path = buildMonotoneCurvePath([
      { x: 0, y: 2 },
      { x: 10, y: 2 },
      { x: 20, y: 6 },
    ]);

    assert.match(path, /C/);
    assert.doesNotMatch(path, /NaN|Infinity/);
  });
});
