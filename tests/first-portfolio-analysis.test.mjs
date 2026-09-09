import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildFirstPortfolioAnalysis } from "../src/lib/first-portfolio-analysis.ts";
import { buildPortfolioStructure } from "../src/lib/portfolio-structure.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const holding = (overrides = {}) => ({ id: "holding-1", account: "new-custom-account", name: "A", ticker: "A", market: "us", currency: "USD", quantity: 2, currentPrice: 100, priceSource: "manual", ...overrides });
const structure = (assets) => buildPortfolioStructure({ assets, assetSelection: "preselected", selectedAccount: "all", usdKrwRate: 1000 });

describe("first portfolio analysis", () => {
  it("values current holdings without cost or personal history and aggregates the same instrument across accounts", () => {
    const model = buildFirstPortfolioAnalysis(structure([holding(), holding({ id: "holding-2", account: "another", quantity: 1 }), holding({ id: "holding-3", ticker: "B", name: "B", market: "korea", currency: "KRW", quantity: 1, currentPrice: 100000 })]));
    assert.equal(model.state, "complete");
    assert.equal(model.totalValueKrw, 400000);
    assert.equal(model.rows.length, 2);
    assert.equal(model.largestHolding.weightPct, 75);
    assert.equal(model.usdWeightPct, 75);
    assert.equal("returnPct" in model, false);
  });
  it("does not turn a partially valued portfolio into a complete 100-percent allocation", () => {
    const model = buildFirstPortfolioAnalysis(structure([holding(), holding({ id: "missing", ticker: "B", currentPrice: null })]));
    assert.equal(model.state, "partial");
    assert.equal(model.totalValueKrw, null);
    assert.equal(model.knownValueKrw, 200000);
    assert.equal(model.unvaluedHoldingCount, 1);
    assert.equal(model.largestHolding, null);
    assert.equal(model.rows[0].weightPct, null);
    assert.equal(model.usdWeightPct, null);
  });
  it("keeps a truly empty portfolio distinct from missing valuations", () => {
    assert.equal(buildFirstPortfolioAnalysis(structure([])).state, "empty");
    assert.equal(buildFirstPortfolioAnalysis(structure([holding({ currentPrice: null })])).state, "partial");
  });
  it("loads owner-scoped composition and readiness together and preserves composition on a readiness failure", async () => {
    const calls = [];
    const options = { scope: { kind: "all", key: "all", label: "All" }, serviceDate: "2026-09-09", tenantContext: { ownerUserId: "owner-a" } };
    let finishPortfolio;
    const portfolio = new Promise((resolve) => { finishPortfolio = resolve; });
    const [query] = await importWithPorts(["src/db/queries/first-portfolio-analysis.ts"], {
      "@/db/queries/portfolio-structure": { getReadOnlyTenantPortfolioStructureForScope(input) { assert.equal(input, options); calls.push("portfolio"); return portfolio; } },
      "@/db/queries/holding-analysis-data-readiness": { getReadOnlyTenantHoldingAnalysisDataReadinessForScope(input) { assert.equal(input, options); calls.push("readiness"); return Promise.reject(new Error("temporary read failure")); } },
    });
    const request = query.getReadOnlyTenantFirstPortfolioAnalysis(options);
    assert.deepEqual(calls, ["portfolio", "readiness"]);
    finishPortfolio(structure([holding()]));
    const result = await request;
    assert.equal(result.summary.totalValueKrw, 200000);
    assert.equal(result.readiness.state, "unavailable");
  });
});
