import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("analysis result journey navigation", () => {
  it("keeps the shared navigation server-rendered and anchor-only", () => {
    const component = read("src/components/analysis-journey-nav.tsx");

    assert.doesNotMatch(component, /["']use client["']/);
    assert.doesNotMatch(component, /\bfetch\s*\(|\/api\//);
    assert.match(component, /href: `#\$\{string\}`/);
    assert.match(component, /data-analysis-journey-nav/);
    assert.match(component, /items\.map/);
  });

  it("keeps Investment Lab analysis sections inside accessible workspace tabs", () => {
    const page = read("src/app/investment-lab/page.tsx");
    const view = read("src/components/investment-lab/investment-lab-view.tsx");
    const workspace = read(
      "src/components/investment-lab/investment-lab-workspace.tsx",
    );
    const source = `${page}\n${view}`;
    const targets = [
      "investment-lab-results",
      "investment-lab-optimizer",
      "investment-lab-etf-xray",
      "investment-lab-small-adjustment",
    ];

    assert.match(view, /<InvestmentLabWorkspace/);
    assert.match(workspace, /role="tablist"/);
    assert.match(workspace, /role="tabpanel"/);
    assert.match(
      workspace,
      /const panels = \{ compare: comparison, weights: experiments, composition \}/,
    );
    assert.match(workspace, /hidden=\{selected !== view\.id\}/);
    for (const target of targets) {
      assert.match(source, new RegExp(`id="${target}"`));
    }
  });

  it("preserves every Simulation section in accessible workspace tabs", () => {
    const view = read(
      "src/components/simulation/simulation-input-readiness-view.tsx",
    );
    const targets = [
      "simulation-current-result",
      "simulation-weight-experiment",
      "simulation-validation",
      "simulation-model-diagnostics",
    ];

    const workspace = read("src/components/simulation/simulation-workspace.tsx");
    assert.match(view, /<SimulationWorkspace/);
    assert.match(workspace, /role="tablist"/);
    assert.match(workspace, /role="tabpanel"/);
    assert.match(workspace, /hidden=\{selected !== view\.id\}/);
    for (const target of targets) {
      assert.match(view, new RegExp(`id="${target}"`));
    }
  });
});

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
