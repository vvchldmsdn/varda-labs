import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const holdingId = "22222222-2222-4222-8222-222222222222";
const tenantContext = { ownerUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const target = { holdingId, accountCode: "custom-account", ticker: "VOO", name: "Vanguard", market: "us", currency: "USD" };

async function setup(options = {}) {
  const config = { authorized: true, target, entries: [{ state: "missing" }], readinessState: "ready", configured: true, ...options };
  const calls = [], enqueued = [];
  const [writer] = await importWithPorts(["src/lib/holding-analysis-data-preparation-write.ts"], {
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => { calls.push("auth"); return config.authorized ? { ok: true, tenantContext } : { ok: false }; } },
    "@/db/queries/holding-analysis-data-readiness": {
      getReadOnlyTenantHoldingAnalysisPreparationTarget: async input => { assert.equal(input.tenantContext, tenantContext); assert.equal(input.holdingId, holdingId); calls.push("owned_target"); return config.target; },
      getReadOnlyTenantHoldingAnalysisDataReadiness: async input => { assert.equal(input.tenantContext, tenantContext); assert.deepEqual(input.holdings, [config.target]); calls.push("shared_readiness"); return { state: config.readinessState, entries: config.entries }; },
    },
    "@/lib/market-data/providers/kis": { getKisProviderPolicy: () => ({ configured: config.configured }) },
    "@/lib/market-data/collection-queue": { enqueueMarketCollection: async jobs => { calls.push("enqueue"); if (config.queueFailure) throw new Error("private DB details"); enqueued.push(jobs); if (config.gate) await config.gate; return { queuedCount: 1, retryAfterSeconds: 10 }; } },
    "@/lib/market-data/collection-worker": { scheduleMarketCollection: () => calls.push("schedule_after") },
    "@/lib/snapshots/market-calendar": { resolveSnapshotCycle: () => ({ snapshotDate: "2026-09-09" }), closeCalendarReferenceDateForAsset: (input, date) => { assert.equal(input, config.target); assert.equal(date, "2026-09-09"); return "2026-09-08"; } },
  });
  const formData = new FormData();
  formData.set("holdingId", holdingId);
  formData.set("ticker", "FOREIGN");
  formData.set("ownerUserId", "foreign-owner");
  return { calls, enqueued, config, formData, run: () => writer.prepareSessionHoldingAnalysisData(formData) };
}

describe("holding history preparation durable queue boundary", () => {
  it("queues only one verified holding history request without private owner fields or synchronous provider work", async () => {
    const f = await setup();
    const result = await f.run();
    assert.equal(result.status, "queued");
    assert.equal(result.retryAfterSeconds, 10);
    assert.deepEqual(f.calls, ["auth", "owned_target", "shared_readiness", "enqueue", "schedule_after"]);
    assert.equal(f.enqueued.length, 1);
    assert.deepEqual(f.enqueued[0], [{ kind: "history", ticker: "VOO", market: "us", currency: "USD", startDate: "2025-08-05", endDate: "2026-09-08" }]);
    assert.doesNotMatch(JSON.stringify(f.enqueued), /owner|account|assetId|holdingId|FOREIGN|foreign-owner/);
    assert.equal((Date.parse(f.enqueued[0][0].endDate) - Date.parse(f.enqueued[0][0].startDate)) / 86400000, 399);
  });

  it("waits for durable admission before scheduling after work or returning queued", async () => {
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const f = await setup({ gate });
    let done = false;
    const result = f.run().then(value => { done = true; return value; });
    await new Promise(setImmediate);
    assert.ok(f.calls.includes("enqueue"));
    assert.equal(f.calls.includes("schedule_after"), false);
    assert.equal(done, false);
    release();
    assert.equal((await result).status, "queued");
    assert.equal(f.calls.at(-1), "schedule_after");
  });

  it("reuses ready shared history without enqueuing or consuming another worker", async () => {
    const f = await setup({ entries: [{ state: "ready" }] });
    assert.equal((await f.run()).status, "already_ready");
    assert.deepEqual(f.calls, ["auth", "owned_target", "shared_readiness"]);
  });

  it("rejects invalid holding identity before session reads", async () => {
    const f = await setup();
    f.formData.set("holdingId", "VOO");
    assert.equal((await f.run()).status, "invalid");
    assert.deepEqual(f.calls, []);
  });

  it("never prepares foreign or deleted holdings absent from the authorized tenant query", async () => {
    const f = await setup({ target: null });
    assert.equal((await f.run()).status, "conflict");
    assert.deepEqual(f.calls, ["auth", "owned_target"]);
    assert.equal(f.enqueued.length, 0);
  });

  it("does not query ownership or enqueue without a session", async () => {
    const f = await setup({ authorized: false });
    assert.equal((await f.run()).status, "unauthorized");
    assert.deepEqual(f.calls, ["auth"]);
  });

  for (const [options, expected] of [
    [{ entries: [{ state: "unsupported", reason: "manual_history_required" }] }, "invalid"],
    [{ entries: [{ state: "unsupported", reason: "managed_sleeve_excluded" }] }, "invalid"],
    [{ entries: [{ state: "blocked" }] }, "conflict"],
    [{ entries: [] }, "error"],
    [{ entries: [{ state: "missing" }, { state: "missing" }] }, "error"],
    [{ readinessState: "unavailable" }, "error"],
    [{ configured: false }, "error"],
    [{ queueFailure: true }, "error"],
  ]) it(`keeps ${JSON.stringify(options)} out of scheduled provider work`, async () => {
    const f = await setup(options);
    const result = await f.run();
    assert.equal(result.status, expected);
    assert.equal(f.calls.includes("schedule_after"), false);
    assert.doesNotMatch(result.message, /private DB/);
  });
});
