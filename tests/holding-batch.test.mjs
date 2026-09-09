import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const accountId = "11111111-1111-4111-8111-111111111111";
const idle = { status: "idle", results: [] };
const success = { status: "success", message: "Saved", assetId: "33333333-3333-4333-8333-333333333333" };
const draft = (key, extra = {}) => ({ key, instrumentId: "", ticker: key, name: key, market: "us", assetType: "stock", quantity: "2", averageCost: "", currentPrice: "100", ...extra });
function request(rows, extra = {}) {
  const data = new FormData();
  data.set("accountId", accountId);
  data.set("holdings", typeof rows === "string" ? rows : JSON.stringify(rows));
  for (const [key, value] of Object.entries(extra)) data.set(key, value);
  return data;
}
async function fixture(outcomes = []) {
  const writes = [];
  const revalidated = [];
  const [actions] = await importWithPorts(["src/app/portfolio/holdings/new/actions.ts"], {
    "next/cache": { revalidatePath: (path) => revalidated.push(path) },
    "@/lib/holding-onboarding-write": { writeSessionHoldingOnboarding: async (data) => {
      writes.push(Object.fromEntries(data));
      const outcome = outcomes[writes.length - 1] ?? success;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    } },
  });
  return { ...actions, writes, revalidated };
}

describe("holding batch saves", () => {
  it("rejects malformed or oversized payloads and more than twelve rows before any write", async () => {
    const f = await fixture();
    for (const rows of ["{broken", " ".repeat(32_001), {}, [], Array.from({ length: 13 }, (_, i) => draft(`A${i}`))]) {
      assert.equal((await f.createHoldingBatch(idle, request(rows))).status, "invalid");
    }
    assert.equal(f.writes.length, 0);
    assert.deepEqual(f.revalidated, []);
  });

  it("validates all rows before writing even when only a later row is invalid", async () => {
    const f = await fixture();
    for (const bad of [draft("B", { quantity: "-1" }), draft("B", { averageCost: "0" }), draft("B", { quantity: 2 }), draft(""), draft("A")]) {
      assert.equal((await f.createHoldingBatch(idle, request([draft("A"), bad]))).status, "invalid");
    }
    assert.equal(f.writes.length, 0);
  });

  it("rejects duplicate canonical instruments regardless of row key or ticker case", async () => {
    const f = await fixture();
    assert.equal((await f.createHoldingBatch(idle, request([draft("one", { ticker: " aapl " }), draft("two", { ticker: "AAPL" })]))).status, "invalid");
    assert.equal(f.writes.length, 0);
  });

  it("accepts twelve distinct holdings and revalidates each affected route only once", async () => {
    const f = await fixture();
    const result = await f.createHoldingBatch(idle, request(Array.from({ length: 12 }, (_, i) => draft(`A${i}`))));
    assert.equal(result.status, "complete");
    assert.equal(f.writes.length, 12);
    assert.equal(result.results.length, 12);
    assert.equal(new Set(f.revalidated).size, f.revalidated.length);
    for (const path of ["/", "/history", "/portfolio/first-look", "/portfolio/onboarding", "/portfolio/holdings/new"]) assert.ok(f.revalidated.includes(path));
  });

  it("preserves successes and stops at quote readiness or authentication failure", async () => {
    for (const failure of [{ status: "price_unavailable", message: "Wait", retryAfterSeconds: 42 }, { status: "unauthorized", message: "Sign in" }]) {
      const f = await fixture([success, failure]);
      const result = await f.createHoldingBatch(idle, request([draft("A"), draft("B"), draft("C")]));
      assert.equal(result.status, "partial");
      assert.deepEqual(result.results, [{ key: "A", result: success }, { key: "B", result: failure }]);
      assert.deepEqual(f.writes.map((row) => row.ticker), ["A", "B"]);
      assert.ok(f.revalidated.includes("/portfolio/first-look"));
    }
  });

  it("writes only submitted retry rows and does not trust success claims in previous client state", async () => {
    const f = await fixture();
    const previous = { status: "partial", results: [{ key: "A", result: success }, { key: "B", result: success }] };
    assert.equal((await f.createHoldingBatch(previous, request([draft("B")]))).status, "complete");
    assert.deepEqual(f.writes.map((row) => row.ticker), ["B"]);
  });

  it("does not convert a duplicate holding conflict into a successful save", async () => {
    const conflict = { status: "conflict", message: "Already registered" };
    const f = await fixture([conflict]);
    const result = await f.createHoldingBatch(idle, request([draft("A")]));
    assert.equal(result.status, "partial");
    assert.deepEqual(result.results, [{ key: "A", result: conflict }]);
    assert.deepEqual(f.revalidated, []);
  });

  it("keeps earlier results after an unexpected writer failure and stops further attempts", async () => {
    const f = await fixture([success, new Error("transport disconnected")]);
    const result = await f.createHoldingBatch(idle, request([draft("A"), draft("B"), draft("C")]));
    assert.equal(result.status, "partial");
    assert.equal(result.results[0].result.status, "success");
    assert.equal(result.results[1].result.status, "error");
    assert.equal(f.writes.length, 2);
    assert.ok(f.revalidated.includes("/portfolio/holdings"));
  });
});
