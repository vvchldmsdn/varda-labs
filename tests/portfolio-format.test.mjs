import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatPercent,
  formatSignedKrw,
} from "../src/components/home/portfolio-format.ts";

describe("portfolio presentation format", () => {
  it("normalizes sub-won residues instead of rendering negative zero", () => {
    assert.equal(formatSignedKrw(-0.49), "₩0");
    assert.equal(formatSignedKrw(0.49), "₩0");
  });

  it("normalizes percent residues below the displayed precision", () => {
    assert.equal(formatPercent(-0.0049, true), "0.00%");
    assert.equal(formatPercent(0.0049, true), "0.00%");
  });

  it("preserves meaningful signs after display rounding", () => {
    assert.equal(formatSignedKrw(-1), "-₩1");
    assert.equal(formatSignedKrw(1), "+₩1");
    assert.equal(formatPercent(-0.01, true), "-0.01%");
    assert.equal(formatPercent(0.01, true), "+0.01%");
  });
});
