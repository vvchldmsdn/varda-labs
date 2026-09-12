import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const [demo, route] = await importWithPorts(["src/lib/public-product-demo.ts", "src/app/api/public-demo/route.ts"], {});
describe("public product examples are fixed synthetic projections", () => {
  it("rejects owner, arbitrary horizon and duplicate input before calculation", () => {
    for (const query of ["view=lab&owner=anything", "view=simulation&horizon=999999", "view=lab&view=simulation", "view=private", "view=lab&amount=1000"]) {
      assert.equal(demo.resolvePublicDemoQuery(new URLSearchParams(query)), null);
    }
  });
  it("returns the same public laboratory example without private identity or financial inputs", async () => {
    const response = await route.GET(new Request("http://localhost/api/public-demo?view=lab"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /public/);
    const payload = await response.json();
    assert.equal(payload.sample, true);
    assert.deepEqual(Object.keys(payload).sort(), ["chart", "kind", "sample"]);
    assert.deepEqual(payload.chart.lines.map(line => line.id), ["actual", "kodex200", "voo", "fixed_mix"]);
    assert.doesNotMatch(JSON.stringify(payload), /ownerUserId|owner_user_id|accountId|email|kingbooob|token/i);
    assert.deepEqual(await (await route.GET(new Request("http://localhost/api/public-demo?view=lab", { headers: { cookie: "untrusted=user2" } }))).json(), payload);
  });
  it("runs the existing sampler for both bounded horizons, with all 1000 paths", () => {
    for (const horizon of [63, 126]) {
      const data = demo.buildPublicProductDemo("simulation", horizon);
      assert.equal(data.sample, true);
      assert.equal(data.execution.assumptions.horizon, horizon);
      assert.equal(data.execution.displayPaths.pathCount, 1000);
      assert.equal(data.execution.displayPaths.values.length, 1000 * (horizon + 1));
      assert.ok(data.execution.displayPaths.values.every(Number.isFinite));
      assert.equal(data.execution.name, "샘플 포트폴리오");
      assert.strictEqual(data, demo.buildPublicProductDemo("simulation", horizon));
      assert.doesNotMatch(JSON.stringify(data), /accountId|ownerUserId|owner_user_id|email/);
    }
  });
  it("returns invalid input instead of admitting private query parameters", async () => {
    assert.equal((await route.GET(new Request("http://localhost/api/public-demo?view=lab&scope=all"))).status, 400);
  });
});
