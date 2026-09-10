import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectSnapshotCutoffFx } from "../src/lib/snapshots/cutoff-fx.ts";

const cutoff = new Date("2026-09-09T22:00:00Z");
const row = (overrides = {}) => ({
  rateDate: "2026-09-09", usdKrw: "1337.5", isSample: false, status: "ok",
  fetchedAt: "2026-09-09T13:24:05Z", ...overrides,
});

describe("snapshot FX observation cutoff", () => {
  it("rejects the overwritten 09:17 FX value when repairing a 07:00 snapshot", () => {
    const prior = row();
    assert.equal(selectSnapshotCutoffFx([row({ rateDate: "2026-09-10", usdKrw: "1338.9",
      fetchedAt: "2026-09-10T00:17:00Z" }), prior], "2026-09-10", cutoff), prior);
  });
  it("accepts an observation exactly at the cutoff", () => {
    const exact = row({ fetchedAt: cutoff });
    assert.equal(selectSnapshotCutoffFx([exact], "2026-09-10", cutoff), exact);
  });
  it("does not invent zero or use failed, sample, undated, or future evidence", () => {
    for (const invalid of [row({ fetchedAt: null }), row({ status: "failed" }),
      row({ isSample: true }), row({ usdKrw: 0 }), row({ usdKrw: Infinity }),
      row({ rateDate: "2026-09-11" }), row({ fetchedAt: "2026-09-09T22:00:00.001Z" })]) {
      assert.equal(selectSnapshotCutoffFx([invalid], "2026-09-10", cutoff), null);
    }
  });
  it("preserves dated FX history for explicitly authorized historical backfills", () => {
    const history = row({ fetchedAt: "2026-09-11T00:00:00Z" });
    assert.equal(selectSnapshotCutoffFx([history], "2026-09-09", null), history);
    assert.equal(selectSnapshotCutoffFx([history], "2026-09-08", null), null);
  });
});
