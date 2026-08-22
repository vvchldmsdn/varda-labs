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

  it("links every Investment Lab journey item to a stable target", () => {
    const page = read("src/app/investment-lab/page.tsx");
    const view = read("src/components/investment-lab/investment-lab-view.tsx");
    const source = `${page}\n${view}`;
    const targets = [
      "investment-lab-results",
      "investment-lab-optimizer",
      "investment-lab-etf-xray",
      "investment-lab-small-adjustment",
    ];

    assert.match(view, /<AnalysisJourneyNav/);
    for (const target of targets) {
      assert.match(source, new RegExp(`href: "#${target}"`));
      assert.match(source, new RegExp(`id="${target}"`));
    }
  });

  it("links every Simulation journey item to an always-rendered wrapper", () => {
    const view = read(
      "src/components/simulation/simulation-input-readiness-view.tsx",
    );
    const targets = [
      "simulation-current-result",
      "simulation-weight-experiment",
      "simulation-validation",
      "simulation-model-diagnostics",
    ];

    assert.match(view, /<AnalysisJourneyNav/);
    for (const target of targets) {
      assert.match(view, new RegExp(`href: "#${target}"`));
      assert.match(view, new RegExp(`id="${target}"`));
    }
  });
});

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}
