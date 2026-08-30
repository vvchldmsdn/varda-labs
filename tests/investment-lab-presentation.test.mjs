import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  defaultLabScenario,
  labKrw,
  labPercent,
  labScenarioDetail,
  labScenarioLabel,
  labValueDomain,
  nearestLabDateIndex,
} from "../src/components/investment-lab/investment-lab-chart-presentation.ts";

const source = (path) => readFileSync(path, "utf8");
const component = (name) => source(`src/components/investment-lab/${name}.tsx`);
const line = (id, values) => ({
  id,
  points: values.map((valueKrw, index) => ({
    serviceDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
    valueKrw,
  })),
});

describe("investment lab presentation", () => {
  it("chooses an available comparison without ranking its returns", () => {
    assert.equal(
      defaultLabScenario({
        lines: [
          line("actual", [100]),
          line("voo", [900]),
          line("kodex200", [50]),
        ],
      }),
      "kodex200",
    );
    assert.equal(
      defaultLabScenario({
        lines: [line("actual", [100]), line("zero_return", [100])],
      }),
      "zero_return",
    );
    assert.equal(
      defaultLabScenario({ lines: [line("actual", [100])] }),
      "actual",
    );
  });

  it("keeps one finite scale across every available path", () => {
    const lines = [line("actual", [100, 150]), line("voo", [90, 500])];
    const domain = labValueDomain(lines);
    assert.ok(domain.minimum < 90);
    assert.ok(domain.maximum > 500);
    assert.deepEqual(labValueDomain(lines.toReversed()), domain);
    assert.ok(labValueDomain([line("actual", [100, 100])]).maximum > 100);
    assert.deepEqual(labValueDomain([]), { minimum: 0, maximum: 1 });
    assert.deepEqual(labValueDomain([line("actual", [NaN, Infinity])]), {
      minimum: 0,
      maximum: 1,
    });
  });

  it("finds the nearest actual observation on irregular calendar dates", () => {
    const dates = ["2026-08-01", "2026-08-03", "2026-08-10"];
    const indexAt = (date) =>
      nearestLabDateIndex(dates, Date.parse(`${date}T00:00:00Z`));
    assert.equal(indexAt("2026-07-20"), 0);
    assert.equal(indexAt("2026-08-02"), 0);
    assert.equal(indexAt("2026-08-03"), 1);
    assert.equal(indexAt("2026-08-06"), 1);
    assert.equal(indexAt("2026-08-07"), 2);
    assert.equal(indexAt("2026-09-01"), 2);
    assert.equal(nearestLabDateIndex([], Date.now()), 0);
  });

  it("distinguishes zero results from unavailable data", () => {
    assert.notEqual(labKrw(0), labKrw(null));
    assert.equal(labKrw(NaN), labKrw(null));
    assert.equal(labPercent(0), "0.00%");
    assert.equal(labPercent(null), labKrw(null));
    assert.match(labKrw(1_000, true), /^\+/);
    assert.match(labPercent(0.0123, true), /^\+1\.23%$/);
  });

  it("keeps a human-readable label and assumption for every scenario", () => {
    for (const id of [
      "actual",
      "kodex200",
      "voo",
      "fixed_mix",
      "preperiod_min_volatility",
      "zero_return",
      "anchor_basket",
      "anchor_value_weight",
      "anchor_current_weight_monthly",
      "approved_target_weight_monthly",
      "anchor_equal_weight_monthly",
    ]) {
      assert.ok(labScenarioLabel(id).length > 0, id);
      assert.ok(labScenarioDetail(id).length > 0, id);
      assert.notEqual(labScenarioLabel(id), id);
    }
  });

  it("keeps presentation switches local and preserves their query state", () => {
    const workspace = component("investment-lab-workspace");
    const controls = component("investment-lab-query-controls");
    assert.match(workspace, /window\.history\.pushState/);
    assert.match(workspace, /role="tablist"/);
    assert.match(workspace, /hidden=\{selected !== view\.id\}/);
    assert.match(workspace, /ArrowRight/);
    assert.match(workspace, /ArrowLeft/);
    assert.match(controls, /\["view", "preview"\]/);
    assert.match(controls, /scroll=\{false\}/);
    for (const name of [
      "investment-lab-period-selector",
      "investment-lab-fixed-mix",
      "investment-lab-anchor-basket",
    ]) {
      assert.match(component(name), /InvestmentLabQueryFields/);
    }
    for (const name of [
      "investment-lab-workspace",
      "investment-lab-chart-canvas",
      "investment-lab-time-machine",
      "investment-lab-dialog",
    ]) {
      assert.doesNotMatch(component(name), /@\/db|\bfetch\s*\(|\/api\//);
    }
  });

  it("keeps dialogs out of document flow and hover tooltips transient", () => {
    const dialog = component("investment-lab-dialog");
    const chart = component("investment-lab-chart-canvas");
    assert.match(dialog, /\.showModal\(\)/);
    assert.match(dialog, /<dialog/);
    assert.match(dialog, /max-h-\[min\(88dvh,850px\)\]/);
    assert.match(dialog, /event\.key !== "Escape"/);
    assert.match(dialog, /onClose=\{\(\) => setOpen\(false\)\}/);
    assert.match(chart, /onPointerLeave=\{\(\) => setHover\(null\)\}/);
    assert.match(chart, /aria-valuetext/);
  });

  it("requires an explicit development flag for synthetic preview data", () => {
    const page = source("src/app/investment-lab/page.tsx");
    const preview = source("src/lib/investment-lab-design-preview.ts");
    assert.match(
      page,
      /process\.env\.NODE_ENV === "development" && params\.preview === "design"/,
    );
    assert.ok(
      page.indexOf("resolveCurrentTenantContext();") <
        page.indexOf("const scopeContext ="),
    );
    assert.doesNotMatch(
      preview,
      /@\/db|process\.env|\bfetch\s*\(|readFile|writeFile/,
    );
  });
});
