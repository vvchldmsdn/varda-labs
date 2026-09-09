import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

class BusyError extends Error { retryAfterSeconds = 45; }
const holdingId = "22222222-2222-4222-8222-222222222222";

async function setup({ leaseBusy = false, ready = false } = {}) {
  const calls = [];
  const builder = { from() { return this; }, where() { return this; }, orderBy() { return this; }, limit: async () => [] };
  const [writer] = await importWithPorts(["src/lib/holding-analysis-data-preparation-write.ts"], {
    "drizzle-orm": { desc: () => ({}), eq: () => ({}) },
    "@/db/client": { db: { select: () => builder } },
    "@/db/schema": { marketDataSyncRuns: {} },
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => ({ ok: true, tenantContext: { ownerUserId: "owner-a" } }) },
    "@/db/queries/holding-analysis-data-readiness": {
      getReadOnlyTenantHoldingAnalysisPreparationTarget: async (input) => { assert.equal(input.tenantContext.ownerUserId, "owner-a"); assert.equal(input.holdingId, holdingId); return { holdingId, accountCode: "custom-account", ticker: "VOO", name: "Vanguard", market: "us", currency: "USD" }; },
      getReadOnlyTenantHoldingAnalysisDataReadiness: async () => ({ state: "ready", entries: [{ state: ready ? "ready" : "missing" }] }),
    },
    "@/lib/market-data/providers/kis": { getKisProviderPolicy: () => ({ configured: true }), createKisMarketDataProvider: () => ({ name: "kis" }) },
    "@/lib/market-data/kis-refresh-lease": { KisRefreshLeaseBusyError: BusyError, withKisRefreshLease: async (task) => { calls.push("lease"); if (leaseBusy) throw new BusyError(); return task(); } },
    "@/lib/market-data/kis-history-cache-sync": { runKisHistoryCacheSync: async (options) => { assert.equal(calls[0], "lease"); assert.equal(options.targets.length, 1); assert.equal(options.targets[0].ticker, "VOO"); assert.deepEqual(options.targets[0].accounts, []); calls.push("provider"); return { failedCount: 0, fetchedRowCount: 130 }; } },
    "@/lib/snapshots/market-calendar": { resolveSnapshotCycle: () => ({ snapshotDate: "2026-09-09" }), closeCalendarReferenceDateForAsset: () => "2026-09-08" },
  });
  const formData = new FormData();
  formData.set("holdingId", holdingId);
  return { calls, run: () => writer.prepareSessionHoldingAnalysisData(formData) };
}

describe("holding history preparation provider budget", () => {
  it("prepares one owner-verified instrument only after obtaining the shared provider lease", async () => {
    const { calls, run } = await setup();
    assert.equal((await run()).status, "success");
    assert.deepEqual(calls, ["lease", "provider"]);
  });
  it("returns a bounded busy state without provider work when another worker owns the lease", async () => {
    const { calls, run } = await setup({ leaseBusy: true });
    const result = await run();
    assert.equal(result.status, "busy");
    assert.equal(result.retryAfterSeconds, 45);
    assert.deepEqual(calls, ["lease"]);
  });
  it("reuses ready shared history without consuming a provider lease", async () => {
    const { calls, run } = await setup({ ready: true });
    assert.equal((await run()).status, "already_ready");
    assert.deepEqual(calls, []);
  });
});
