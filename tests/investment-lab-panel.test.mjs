import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveInvestmentLabPanel,
  startInvestmentLabPanelQueries,
} from "../src/lib/investment-lab-panel.ts";

function queries() {
  const called = [];
  const portfolio = Promise.resolve({ id: "scoped-portfolio" });
  return {
    called,
    portfolio,
    loaders: {
      portfolio() { called.push("portfolio"); return portfolio; },
      async etfXray(input) {
        called.push("xray");
        assert.equal(input, portfolio);
        return { portfolio: await input };
      },
      async stressReplay(input) {
        called.push("stress");
        assert.equal(input, portfolio);
        return { portfolio: await input };
      },
    },
  };
}

describe("investment lab detail query scheduling", () => {
  it("starts no structure, xray, or stress reads on the main or invalid view", () => {
    for (const view of [undefined, null, "", "unknown", ["composition"], ["weights", "composition"]]) {
      const { called, loaders } = queries();
      const result = startInvestmentLabPanelQueries(resolveInvestmentLabPanel(view), loaders);
      assert.deepEqual(called, []);
      assert.deepEqual(result, { portfolioStructurePromise: null, etfXrayPromise: null, stressReplayPromise: null });
    }
  });

  it("loads only the shared portfolio needed for the small-adjustment experiment", async () => {
    const { called, loaders, portfolio } = queries();
    const result = startInvestmentLabPanelQueries(resolveInvestmentLabPanel("weights"), loaders);
    assert.deepEqual(called, ["portfolio"]);
    assert.equal(result.portfolioStructurePromise, portfolio);
    assert.equal(result.etfXrayPromise, null);
    assert.equal(result.stressReplayPromise, null);
    assert.equal((await result.portfolioStructurePromise).id, "scoped-portfolio");
  });

  it("starts composition reads together against one scoped portfolio promise", async () => {
    const { called, loaders } = queries();
    const result = startInvestmentLabPanelQueries(resolveInvestmentLabPanel("composition"), loaders);
    assert.deepEqual(called, ["portfolio", "xray", "stress"]);
    const [portfolio, xray, stress] = await Promise.all([
      result.portfolioStructurePromise, result.etfXrayPromise, result.stressReplayPromise,
    ]);
    assert.equal(xray.portfolio, portfolio);
    assert.equal(stress.portfolio, portfolio);
  });
});
