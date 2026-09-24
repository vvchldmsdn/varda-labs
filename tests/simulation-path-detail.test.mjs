import assert from "node:assert/strict";
import { test } from "node:test";
import { SimulationPathDetailStore, inversePathFactor, PATH_DETAIL_LIMITS } from "../src/lib/simulation-path-detail-store.ts";
import { bootstrapPathSnapshot, economicPathSnapshot } from "../src/lib/simulation-path-snapshot.ts";
import { buildSimulationOwnerEconomicResearch } from "../src/lib/simulation-owner-economic-research.ts";
import { prepareSimulationResearchPaths, executeSimulationResearchPathsFromPrepared } from "../src/lib/simulation-research-execution-core.ts";
import { readyOwnerMatrix, ownerWeights } from "./support/simulation-owner-ready-matrix.mjs";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

function fixture() {
  return {
    model: "economic", modelVersion: "simulation_economic_state_conditional_mean_v1", currency: "KRW", seed: 42, horizon: 2, pathCount: 2, provenance: "matrix:fixture;vector:60/40", coveragePct: 80,
    assets: [{ key: "a", label: "긴 이름 Long asset name", weightBps: 6000 }, { key: "b", label: "B", weightBps: 4000 }],
    growth: Float64Array.from([1, 1, 1.1, .9, 1.2, .8, 1, 1, .9, 1.1, .8, 1.2]),
    chart: Float64Array.from([100, 102, 104, 100, 98, 96]),
    factors: [{ key: "usdkrw", label: "USD/KRW", unit: "KRW / USD", transform: "log_level", observationDate: "2026-09-01", source: "synthetic" }],
    states: Float64Array.from([1400, 1380, 1360, 1400, 1420, 1440].map(Math.log)),
    drawRows: new Int32Array(), blockStarts: new Uint8Array(), history: [],
  };
}

test("exact selected path, independent numeric expectations, reconciliation, factors and drawdown", () => {
  const store = new SimulationPathDetailStore();
  const input = fixture();
  const handle = store.register("ownerA", input);
  assert.ok(handle);
  const result = store.read("ownerA", handle, 1);
  assert.ok(result.ok);
  assert.deepEqual(result.detail.portfolio.map(v => Math.round(v)), [100, 98, 96]);
  assert.deepEqual(result.detail.assets[0].values, [60, 54, 48]);
  assert.deepEqual(result.detail.assets[1].values, [40, 44.00000000000001, 48]);
  assert.ok(Math.abs(result.detail.finalReturnPct + 4) < 1e-12);
  assert.ok(Math.abs(result.detail.maxDrawdownPct - 4) < 1e-12);
  for (let step = 0; step < 3; step++) {
    assert.ok(Math.abs(result.detail.factors[0].values[step] - [1400,1420,1440][step]) < 1e-9);
    assert.ok(Math.abs(result.detail.assets.reduce((sum, asset) => sum + asset.values[step], 0) - result.detail.portfolio[step]) < 1e-12);
  }
  assert.deepEqual(result.detail.draws, []);
  // Later caller mutation must not silently alter a retained execution.
  input.growth.fill(50); input.assets[0].label = "changed";
  assert.deepEqual(store.read("ownerA", handle, 1), result);
});

test("owner/currency/model/path/expiry and memory bounds fail closed", () => {
  let now = 1000;
  const store = new SimulationPathDetailStore(() => now);
  const h = store.register("A", fixture());
  assert.equal(store.read("B", h, 0).status, 404);
  for (const patch of [{ currency: "USD" }, { model: "bootstrap" }, { binding: "x" }, { expiresAt: 0 }, { preview: true }]) assert.equal(store.read("A", { ...h, ...patch }, 0).status, 409);
  for (const p of [-1, 2, .5, NaN]) assert.equal(store.read("A", h, p).status, 400);
  assert.equal(store.read("A", { ...h, executionId: "missing" }, 0).status, 410);
  const usd = store.register("A", { ...fixture(), currency: "USD" });
  assert.notEqual(usd.binding, h.binding);
  assert.equal(store.read("A", usd, 0).detail.currency, "USD");
  now += PATH_DETAIL_LIMITS.ttlMs;
  assert.equal(store.read("A", h, 0).status, 410);
  assert.equal(store.retainedBytes, 0);
  assert.equal(new SimulationPathDetailStore(() => 0, 10).register("A", fixture()), undefined);
  assert.equal(store.register("A", { ...fixture(), horizon: 127 }), undefined);
  assert.equal(store.register("A", { ...fixture(), pathCount: 1001 }), undefined);
});

test("unknown inverses are excluded, mismatched chart is not rescaled", () => {
  const store = new SimulationPathDetailStore();
  const s = fixture(); s.factors[0].transform = "latent";
  const h = store.register("A", s);
  assert.deepEqual(store.read("A", h, 0).detail.factors, []);
  assert.equal(inversePathFactor("unknown", "us_10y_yield", "level", "%", 4), null);
  assert.equal(inversePathFactor(s.modelVersion, "us_10y_yield", "level", "%", 4), 4);
  assert.equal(inversePathFactor(s.modelVersion, "us_10y2y_curve", "level", "pp", -.2), -.2);
  s.chart[2] = 200;
  const mismatch = store.register("A", s);
  assert.equal(store.read("A", mismatch, 0).status, 422);
});

test("1000-path actual engines: adapters preserve chart/draw/step identity and only one bounded projection", () => {
  const matrix = readyOwnerMatrix();
  const weights = ownerWeights([5000, 2500, 2500]);
  const prepared = prepareSimulationResearchPaths({ matrix, seed: 42, expectedBlockLength: 5, horizon: 21, pathCount: 1000 });
  const execution = { ...executeSimulationResearchPathsFromPrepared({ prepared, scenarioId: "test", scenarioVersion: "1", weights, samplePathCount: 12, includeDisplayPaths: true }), account: "all", executionWeights: weights, instruments: matrix.instruments.map(row => ({ ...row, name: row.ticker })), coverage: { modeledCurrentValuePct: 80 }, source: { endServiceDate: matrix.requestedServiceDates.at(-1) } };
  const preview = { execution, prepared, matrix };
  assert.equal(preview.execution.status, "ready");
  const factorRows = matrix.requestedServiceDates.flatMap((date, i) => [["usdkrw", 1300 + i * .7 + Math.sin(i / 5) * 4], ["us_10y_yield", 4 + Math.sin(i / 7) * .08], ["us_10y2y_curve", .2 + Math.cos(i / 9) * .04]].map(([factorKey, value]) => ({ factorKey, value, factorDate: date, periodEndDate: date, releaseDate: date, volatility20dPct: 1 })));
  const economic = buildSimulationOwnerEconomicResearch({ account: "all", matrix, weights, horizon: 21, ownerExecutionReady: true, factorRows, includeDisplayPaths: true });
  assert.equal(economic.status, "ready");
  for (const [snapshot, execution] of [[bootstrapPathSnapshot(preview.execution, preview.prepared), preview.execution], [economicPathSnapshot(economic, preview.execution), economic]]) {
    const store = new SimulationPathDetailStore();
    assert.equal(snapshot.pathCount, 1000);
    const h = store.register("A", snapshot);
    assert.ok(h);
    assert.ok(Buffer.byteLength(JSON.stringify(h)) < 300);
    assert.ok(!JSON.stringify(h).includes("growth"));
    for (const p of [0, 141, 999]) {
      const result = store.read("A", h, p);
      assert.ok(result.ok, JSON.stringify(result));
      assert.equal(result.detail.pathIndex, p);
      for (let step = 0; step <= 21; step++) {
        assert.equal(Number(result.detail.portfolio[step].toPrecision(7)), execution.displayPaths.values[p * 22 + step]);
        assert.ok(Math.abs(result.detail.assets.reduce((sum, asset) => sum + asset.values[step], 0) - result.detail.portfolio[step]) < 1e-10);
      }
      if (snapshot.model === "bootstrap") {
        assert.deepEqual(result.detail.factors, []);
        for (const draw of result.detail.draws) {
          const original = preview.prepared.drawPlan.paths[p].draws[draw.step - 1];
          assert.equal(draw.from, original.previousServiceDate);
          assert.equal(draw.to, original.serviceDate);
          assert.equal(draw.blockStart, original.blockStart);
          assert.equal(result.detail.assets[0].returns[draw.step], preview.matrix.matrix[original.sourceRowIndex].cells[0].value);
        }
      } else {
        assert.equal(result.detail.draws.length, 0);
        assert.ok(Math.abs(result.detail.factors[0].values[7] - Math.exp(economic.prepared.factorStates[(p * 22 + 7) * 3])) < 1e-10);
      }
      assert.ok(Buffer.byteLength(JSON.stringify(result.detail)) < PATH_DETAIL_LIMITS.responseBytes);
      if (p === 141) console.info("path-detail payload bytes", snapshot.model, { handle: Buffer.byteLength(JSON.stringify(h)), selected: Buffer.byteLength(JSON.stringify(result.detail)) });
    }
  }
});

test("owner FIFO eviction and worst supported selected-path payload remain bounded", () => {
  const store = new SimulationPathDetailStore();
  const first = store.register("A", fixture());
  store.register("A", { ...fixture(), seed: 43 });
  store.register("A", { ...fixture(), seed: 44 });
  assert.equal(store.read("A", first, 0).status, 410);
  const s = fixture(); s.horizon = 126; s.pathCount = 1000;
  s.assets = Array.from({ length: 64 }, (_, i) => ({ key: `asset${i}`, label: "long 한글 ".repeat(20), weightBps: i === 0 ? 172 : 156 }));
  s.growth = new Float64Array(1000 * 127 * 64).fill(1);
  s.chart = new Float64Array(1000 * 127).fill(100);
  s.states = new Float64Array(1000 * 127).fill(Math.log(1400));
  const h = store.register("large", s);
  assert.ok(h);
  const result = store.read("large", h, 999);
  assert.ok(result.ok);
  assert.equal(result.detail.assets.length, 64);
  assert.ok(Buffer.byteLength(JSON.stringify(result.detail)) < PATH_DETAIL_LIMITS.responseBytes);
  assert.ok(store.retainedBytes <= PATH_DETAIL_LIMITS.bytes);
  console.info("path-detail 64 assets / 126 steps bytes", Buffer.byteLength(JSON.stringify(result.detail)));
});

test("actual HTTP route enforces session, same-origin, bounded bodies, owner binding and production preview denial", async () => {
  const store = new SimulationPathDetailStore();
  const handle = store.register("A", fixture());
  let session = { ok: false };
  const [route] = await importWithPorts(["src/app/api/simulation/path-detail/route.ts"], {
    "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => session },
    "@/lib/server/simulation-path-details": { simulationPathDetails: store },
  });
  const request = (body = { handle, pathIndex: 0 }, headers = {}, query = "") => new Request(`http://127.0.0.1/api/simulation/path-detail${query}`, { method: "POST", headers: { origin: "http://127.0.0.1", "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
  assert.equal((await route.POST(request())).status, 401);
  session = { ok: true, tenantContext: { ownerUserId: "B" } };
  assert.equal((await route.POST(request())).status, 404);
  session = { ok: true, tenantContext: { ownerUserId: "A" } };
  const response = await route.POST(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal((await response.json()).pathIndex, 0);
  assert.equal((await route.POST(request(undefined, { origin: "https://attacker.test" }))).status, 400);
  assert.equal((await route.POST(request(undefined, { origin: "http://127.0.0.1:3198", host: "127.0.0.1:3198", "sec-fetch-site": "same-origin" }))).status, 200);
  assert.equal((await route.POST(request(undefined, { origin: "https://attacker.test", "x-forwarded-host": "attacker.test" }))).status, 400);
  assert.equal((await route.POST(request(undefined, {}, "?owner=A"))).status, 400);
  assert.equal((await route.POST(request("{"))).status, 400);
  assert.equal((await route.POST(request("x".repeat(5000)))).status, 400);
  const originalEnv = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.equal((await route.POST(request({ handle: { ...handle, preview: true }, pathIndex: 0 }))).status, 404);
  } finally { if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv; }
});
