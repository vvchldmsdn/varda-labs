import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

describe("Daily market cycle cutoff recovery", () => {
  it("uses the collection lease and completes close sync without a legacy cooldown veto", async () => {
    const f = await fixture({ missingClose: true });
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.deepEqual(f.events, ["collection-lease", "claim", "factors", "preflight", "close", "preflight", "snapshot", "fx", "live", "finish:completed"]);
    assert.equal(result.closeSync.successCount, 1);
    assert.equal(result.snapshot.writtenCount, 1);
  });

  it("preserves an admitted snapshot when an unrelated live target is missing", async () => {
    const f = await fixture({ liveResult: { successCount: 0, failedCount: 1, insertedCount: 0 } });
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.equal(result.snapshot.writtenCount, 1);
    assert.equal(result.liveSync.status, "partial");
    assert.ok(f.events.indexOf("snapshot") < f.events.indexOf("live"));
    assert.equal(f.finished.at(-1).metadata.liveSync.failedCount, 1);
  });

  it("records a live provider exception without losing a completed cutoff snapshot", async () => {
    const f = await fixture({ liveError: true });
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.equal(result.snapshot.writtenCount, 1);
    assert.equal(result.liveSync.status, "failed");
    assert.equal(f.finished.at(-1).status, "completed");
  });

  it("captures the pre-cutoff FX observation before a refresh overwrites it", async () => {
    const f = await fixture();
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.equal(f.snapshotFx(), 1375);
    assert.equal(f.currentFx(), 1382);
    assert.equal(result.fx.status, "written");
  });

  it("keeps the snapshot completed and refreshes live quotes after an FX exception", async () => {
    const f = await fixture({ fxError: true });
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.equal(result.snapshot.writtenCount, 1);
    assert.equal(result.fx.status, "failed");
    assert.equal(result.liveSync.status, "completed");
    assert.equal(f.finished.at(-1).metadata.fx.status, "failed");
  });

  it("does not turn a blocked auxiliary FX refresh into a failed snapshot", async () => {
    const f = await fixture({ fxStatus: "blocked", liveError: true });
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.equal(result.fx.status, "failed");
    assert.equal(result.liveSync.status, "failed");
    assert.equal(result.snapshot.writtenCount, 1);
  });

  it("can save already admitted evidence while KIS is unavailable", async () => {
    const f = await fixture({ configured: false });
    const result = await f.run();
    assert.equal(result.status, "completed");
    assert.equal(result.liveSync.status, "not_attempted");
    assert.equal(result.snapshot.writtenCount, 1);
    assert.ok(!f.events.includes("live"));
  });

  it("does not create a snapshot when required official close evidence stays missing", async () => {
    const f = await fixture({ missingClose: true, closeSucceeds: false });
    const result = await f.run();
    assert.equal(result.status, "blocked");
    assert.ok(result.blockers.includes("close_sync_incomplete"));
    assert.ok(!f.events.includes("snapshot"));
    assert.ok(!f.events.includes("live"));
  });

  it("retains a genuine snapshot write failure and skips auxiliary live work", async () => {
    const f = await fixture({ snapshotWriteFails: true });
    const result = await f.run();
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["snapshot_write_incomplete"]);
    assert.equal(result.snapshot.writtenCount, 0);
    assert.ok(!f.events.includes("live"));
    assert.ok(!f.events.includes("fx"));
  });

  it("does not repeat a completed service date", async () => {
    const f = await fixture({ alreadyCompleted: true });
    const result = await f.run();
    assert.equal(result.status, "already_attempted");
    assert.equal(result.ok, true);
    assert.deepEqual(f.events, ["collection-lease", "claim"]);
    assert.equal(f.finished.length, 0);
  });

  it("writes an eligible owner's cutoff even when a new tenant cannot reconstruct its holdings", async () => {
    const f = await fixture({ blockedTenant: true });
    const result = await f.run();
    assert.ok(f.events.includes("snapshot"));
    assert.equal(result.status, "blocked");
    assert.deepEqual(result.snapshot, { targetCount: 2, writtenCount: 1, blockedCount: 0, failedCount: 1 });
    assert.ok(result.blockers.includes("snapshot_preflight_error:holdings_changed_after_cutoff"));
    assert.equal(f.finished.at(-1).metadata.snapshot.writtenCount, 1);
  });

  it("does not report success when existing owners need no write but another tenant is blocked", async () => {
    const f = await fixture({ blockedTenant: true, snapshotsExist: true });
    const result = await f.run();
    assert.equal(result.status, "blocked");
    assert.equal(result.snapshot.failedCount, 1);
    assert.ok(!f.events.includes("snapshot"));
    assert.ok(result.blockers.includes("snapshot_preflight_error:holdings_changed_after_cutoff"));
  });
});

async function fixture({ missingClose = false, closeSucceeds = true, liveResult = {}, liveError = false, fxError = false, fxStatus = "written", configured = true, snapshotWriteFails = false, alreadyCompleted = false, blockedTenant = false, snapshotsExist = false } = {}) {
  const events = [], finished = [];
  let missing = missingClose;
  let currentFx = 1375, snapshotFx = null;
  const now = new Date("2026-09-09T22:58:55.000Z");
  const completeSync = { requestedCount: 1, successCount: 1, failedCount: 0, skippedCount: 0, insertedCount: 1, updatedCount: 0, conflictCount: 0, targetFilterSummary: { filteredPriceTargetCount: 1 } };
  const [runner] = await importWithPorts(["src/lib/cron-market-cycle-runner.ts"], {
    "@/lib/market-data/collection-worker": { scheduleMarketCollection() {} },
    "@/lib/market-data/kis-refresh-lease": {
      KisRefreshLeaseBusyError: class extends Error {},
      async withKisCollectionLeaseWait(task) { events.push("collection-lease"); return task(); },
    },
    "@/lib/cron-market-cycle-run-repository": {
      async claimCronMarketCycleRun(input) {
        assert.equal(input.snapshotDate, "2026-09-10");
        events.push("claim");
        return alreadyCompleted ? { outcome: "already_attempted", runId: "run", status: "completed" } : { outcome: "claimed", runId: "run" };
      },
      async finishCronMarketCycleRun(input) { events.push(`finish:${input.status}`); finished.push(input); },
    },
    "@/lib/market-data/fx-refresh-job": { async runUsdKrwFxRefreshJob() {
      events.push("fx");
      if (fxError) throw new Error("fixture FX provider failure");
      if (fxStatus === "written") currentFx = 1382;
      return { status: fxStatus, candidate: { rateDate: "2026-09-09", source: "kis" } };
    } },
    "@/lib/market-data/core-market-factor-refresh-job": { async runCoreMarketFactorRefreshJob() { events.push("factors"); return { insertedCount: 0, candidateCount: 0, skippedCount: 0, latestCandidateDate: null }; } },
    "@/lib/market-data/providers/kis": { getKisProviderPolicy: () => ({ configured }), createKisMarketDataProvider: () => ({ name: "kis" }) },
    "@/lib/market-data/price-sync": {
      async getKisPriceSyncCooldownStatus() { assert.fail("collection lease must not be vetoed by a completed job cooldown"); },
      async runMarketPriceSync({ mode }) {
        events.push(mode);
        if (mode === "close") { if (closeSucceeds) missing = false; return completeSync; }
        if (liveError) throw new Error("fixture provider failure");
        return { ...completeSync, ...liveResult };
      },
    },
    "@/lib/snapshots/daily-job": { async runDailySnapshotJob({ dryRun }) {
      events.push(dryRun ? "preflight" : "snapshot");
      if (!dryRun) snapshotFx = currentFx;
      const failed = !dryRun && snapshotWriteFails;
      const counts = { insert: snapshotsExist ? 0 : 1, update: 0, skip: 0, blocked: 0 };
      return {
        ok: !missing && !failed && !blockedTenant, writeReady: !missing && !blockedTenant, snapshotDate: "2026-09-10", targetCount: blockedTenant ? 2 : 1,
        writtenCount: dryRun || failed ? 0 : 1, blockedCount: missing ? 1 : 0, failedCount: (failed ? 1 : 0) + (blockedTenant ? 1 : 0),
        targets: [{ status: missing ? "blocked" : "ready", result: {
          writeReady: !missing,
          closeSyncPlan: { missingCount: missing ? 1 : 0, staleCount: 0, suggestedKisBatches: missing ? [{ market: "korea", expectedCloseDate: "2026-09-09", tickers: ["069500"] }] : [] },
          plannedWrites: { dailyPortfolioSnapshots: counts, dailyPositionSnapshots: counts }, results: {},
        } }, ...(blockedTenant ? [{ status: "failed", error: { code: "holdings_changed_after_cutoff" } }] : [])],
      };
    } },
  });
  return { events, finished, snapshotFx: () => snapshotFx, currentFx: () => currentFx, run: () => runner.runCronMarketCycle({ now }) };
}
