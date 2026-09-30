import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectSnapshotCutoffFx, selectSnapshotExecutionFx } from "../src/lib/snapshots/cutoff-fx.ts";

const cutoff = new Date("2026-09-09T22:00:00Z");
const row = (overrides = {}) => ({
  rateDate: "2026-09-09", usdKrw: "1337.5", isSample: false, status: "ok",
  observedAt: "2026-09-09T13:24:05Z", rateKind: "daily_reference",
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


describe("execution-collected FX policy", () => {
  const at = new Date("2026-09-29T22:59:00Z");
  const fresh = row({rateDate:"2026-09-30",fetchedAt:"2026-09-29T22:58:59Z",observedAt:null,rateKind:null});
  it("accepts a fresh post-07 receipt without claiming a provider tick", () => {
    assert.equal(selectSnapshotExecutionFx([fresh],"2026-09-30",at),fresh);
    assert.equal(selectSnapshotCutoffFx([fresh],"2026-09-30",new Date("2026-09-29T22:00:00Z")),null);
    assert.equal(fresh.observedAt,null);
  });
  it("rejects missing, stale, future, failed, sample and conflicting receipts", () => {
    for (const patch of [{fetchedAt:null},{fetchedAt:"2026-09-29T22:43:59Z"},{fetchedAt:"2026-09-29T23:00:00Z"},
      {observedAt:"2026-09-29T23:00:00Z",rateKind:"spot"},{rateDate:"2026-10-01"},{rateDate:"2026-09-26"},
      {rateDate:"invalid"},{status:"failed"},{isSample:true},{usdKrw:0},{rateKind:"unknown"}]) {
      assert.equal(selectSnapshotExecutionFx([{...fresh,...patch}],"2026-09-30",at),null,JSON.stringify(patch));
    }
    assert.equal(selectSnapshotExecutionFx([fresh,{...fresh,usdKrw:"1400"}],"2026-09-30",at),null);
  });
  it("does not renew an expired provider reference just by fetching it again", () => {
    const reference={...fresh,rateDate:"2026-09-29",rateKind:"daily_reference",observedAt:"2026-09-29T13:00:00Z"};
    assert.equal(selectSnapshotExecutionFx([reference],"2026-09-30",at),reference);
    assert.equal(selectSnapshotExecutionFx([{...reference,observedAt:"2026-09-25T13:00:00Z"}],"2026-09-30",at),null);
  });
});
