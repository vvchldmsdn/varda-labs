import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allocateTargetDeficits } from "../src/lib/target-deficit-allocation.ts";

describe("scope-aware target deficit allocation", () => {
  it("keeps the exact account destination for duplicate tickers", () => {
    const result = allocateTargetDeficits({
      cashAmountKrw: 1_000,
      rows: [
        row("account-a:asset-a", 1_000, 4_000, { account: "증권", ticker: "VOO" }),
        row("account-b:asset-b", 1_000, 6_000, { account: "연금", ticker: "VOO" }),
      ],
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.rows.map((item) => [item.metadata.account, item.metadata.ticker, item.allocationKrw]),
      [
        ["증권", "VOO", 200],
        ["연금", "VOO", 800],
      ],
    );
  });

  it("allocates integer KRW deterministically and preserves the cash invariant", () => {
    const result = allocateTargetDeficits({
      cashAmountKrw: 1_001,
      rows: [
        row("b", 0, 4_000, null),
        row("a", 0, 4_000, null),
        row("c", 1_000, 2_000, null),
      ],
    });

    assert.equal(result.status, "ready");
    assert.deepEqual(
      result.rows.map((item) => [item.allocationKey, item.allocationKrw]),
      [
        ["a", 501],
        ["b", 500],
        ["c", 0],
      ],
    );
    assert.equal(result.totalAllocatedKrw + result.residualCashKrw, 1_001);
  });

  it("blocks incomplete, duplicate, and unbuyable positive target vectors", () => {
    const incomplete = allocateTargetDeficits({
      cashAmountKrw: 100,
      rows: [row("a", 0, 9_999, null)],
    });
    const duplicate = allocateTargetDeficits({
      cashAmountKrw: 100,
      rows: [row("a", 0, 5_000, null), row("a", 0, 5_000, null)],
    });
    const unbuyable = allocateTargetDeficits({
      cashAmountKrw: 100,
      rows: [
        row("a", 0, 5_000, null, false),
        row("b", 1_000, 5_000, null),
      ],
    });

    assert.ok(incomplete.blockers.includes("target_policy_incomplete"));
    assert.ok(duplicate.blockers.includes("duplicate_allocation_key"));
    assert.ok(unbuyable.blockers.includes("unallocatable_target_deficit"));
  });
});

function row(allocationKey, currentValueKrw, targetWeightBps, metadata, buyable = true) {
  return Object.freeze({
    allocationKey,
    buyable,
    currentValueKrw,
    targetWeightBps,
    metadata,
  });
}
