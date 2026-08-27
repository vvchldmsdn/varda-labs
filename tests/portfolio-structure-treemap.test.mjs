import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { layoutPortfolioTreemap } from "../src/lib/portfolio-structure-treemap.ts";

const EPSILON = 1e-7;

describe("portfolio structure treemap", () => {
  it("lays out deterministic, non-overlapping rectangles that preserve area", () => {
    const input = [
      { key: "large", value: 50 },
      { key: "medium", value: 30 },
      { key: "small", value: 20 },
    ];

    const first = layoutPortfolioTreemap(input);
    const second = layoutPortfolioTreemap(input);

    assert.deepEqual(first, second);
    assert.equal(first.length, input.length);

    const totalArea = first.reduce(
      (sum, rectangle) => sum + rectangle.width * rectangle.height,
      0,
    );
    assert.ok(Math.abs(totalArea - 5_600) < EPSILON);

    for (const rectangle of first) {
      assert.ok(rectangle.x >= 0);
      assert.ok(rectangle.y >= 0);
      assert.ok(rectangle.x + rectangle.width <= 100 + EPSILON);
      assert.ok(rectangle.y + rectangle.height <= 56 + EPSILON);
    }

    for (let leftIndex = 0; leftIndex < first.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < first.length;
        rightIndex += 1
      ) {
        assert.equal(overlaps(first[leftIndex], first[rightIndex]), false);
      }
    }
  });

  it("ignores invalid values and rejects invalid layout dimensions", () => {
    assert.deepEqual(
      layoutPortfolioTreemap([
        { key: "kept", value: 10 },
        { key: "zero", value: 0 },
        { key: "negative", value: -1 },
        { key: "invalid", value: Number.NaN },
      ]).map((rectangle) => rectangle.key),
      ["kept"],
    );

    assert.deepEqual(layoutPortfolioTreemap([{ key: "kept", value: 10 }], 0), []);
    assert.deepEqual(
      layoutPortfolioTreemap([{ key: "kept", value: 10 }], 100, -1),
      [],
    );
  });
});

function overlaps(left, right) {
  const overlapWidth =
    Math.min(left.x + left.width, right.x + right.width) -
    Math.max(left.x, right.x);
  const overlapHeight =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  return overlapWidth > EPSILON && overlapHeight > EPSILON;
}
