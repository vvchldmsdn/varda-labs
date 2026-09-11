import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import {
  forEachSimulationFanPathPoint,
  nearestSimulationBand,
  nearestSimulationFanPath,
  nearestSimulationFanPathPoint,
  resolveResearchFanChartValueDomain,
  resolveSimulationFanPathSource,
  simulationFanPathCount,
  simulationFanPathIdentity,
  simulationReturnLabel,
} from "../src/components/simulation/simulation-presentation.ts";

const bands = [
  { stepIndex: 0, p10: 100, p50: 100, p90: 100 },
  { stepIndex: 4, p10: 93, p50: 104, p90: 110 },
  { stepIndex: 10, p10: 85, p50: 109, p90: 128 },
];
const execution = {
  id: "a",
  name: "test",
  assumptions: { horizon: 10 },
  bands,
  samplePaths: [
    {
      pathIndex: 0,
      points: [
        { stepIndex: 0, indexValue: 100 },
        { stepIndex: 10, indexValue: 145 },
      ],
    },
  ],
};

describe("simulation presentation", () => {
  it("keeps a shared domain across percentile and sample paths, anchored at 100", () => {
    assert.deepEqual(resolveResearchFanChartValueDomain([execution]), {
      min: 85,
      max: 145,
    });
    assert.deepEqual(resolveResearchFanChartValueDomain([]), {
      min: 100,
      max: 100,
    });
    assert.deepEqual(
      resolveResearchFanChartValueDomain([
        {
          ...execution,
          bands: [],
          samplePaths: [
            { pathIndex: 0, points: [{ stepIndex: 1, indexValue: NaN }] },
          ],
        },
      ]),
      { min: 100, max: 100 },
    );
  });
  it("uses actual step indices and clamps either end without interpolating evidence", () => {
    assert.equal(nearestSimulationBand(bands, -4), bands[0]);
    assert.equal(nearestSimulationBand(bands, 6), bands[1]);
    assert.equal(nearestSimulationBand(bands, 9), bands[2]);
    assert.equal(nearestSimulationBand(bands, 100), bands[2]);
    assert.equal(nearestSimulationBand([], 2), null);
  });
  it("includes every complete path and intermediate extreme in the visible domain", () => {
    const full = { ...execution, assumptions: { horizon: 2 }, displayPaths: {
      pathCount: 1000, horizon: 2,
      values: Array.from({ length: 1000 }, (_, path) => [100, path === 999 ? 400 : 100, path === 998 ? 20 : 110]).flat(),
    } };
    const source = resolveSimulationFanPathSource(full);
    assert.equal(source.kind, "all");
    assert.equal(simulationFanPathCount(source), 1000);
    assert.equal(simulationFanPathIdentity(source, 999), 999);
    assert.deepEqual(resolveResearchFanChartValueDomain([full]), { min: 20, max: 400 });
    const actual = [];
    forEachSimulationFanPathPoint(source, 999, (step, value) => actual.push([step, value]));
    assert.deepEqual(actual, [[0, 100], [1, 400], [2, 110]]);
    assert.equal(nearestSimulationFanPath(source, 1, 399, value => value, 3), 999);
  });
  it("inspects complete and sparse sample paths without treating array offsets as steps", () => {
    const full = resolveSimulationFanPathSource({ ...execution, assumptions: { horizon: 2 }, displayPaths: {
      pathCount: 2, horizon: 2, values: [100, 90, 95, 100, 110, 108],
    } });
    assert.deepEqual(nearestSimulationFanPathPoint(full, 1, 1.1), { stepIndex: 1, indexValue: 110 });
    assert.deepEqual(nearestSimulationFanPathPoint(full, 0, 999), { stepIndex: 2, indexValue: 95 });
    assert.equal(nearestSimulationFanPath(full, 1, 109, value => value, 3), 1);
    assert.equal(nearestSimulationFanPath(full, 1, 150, value => value, 3), null);
    const sample = resolveSimulationFanPathSource({ ...execution, samplePaths: [{ pathIndex: 47, points: [{ stepIndex: 0, indexValue: 100 }, { stepIndex: 10, indexValue: 145 }] }] });
    assert.equal(sample.kind, "sample");
    assert.equal(simulationFanPathIdentity(sample, 0), 47);
    assert.deepEqual(nearestSimulationFanPathPoint(sample, 0, 9), { stepIndex: 10, indexValue: 145 });
    assert.equal(nearestSimulationFanPathPoint(sample, 1, 0), null);
  });
  it("does not label incomplete or invalid payloads as all paths", () => {
    for (const displayPaths of [null,
      { pathCount: 1, horizon: 10, values: [100] },
      { pathCount: 1, horizon: 1, values: [100, 110] },
      { pathCount: 1, horizon: 10, values: Array(11).fill(NaN) },
      { pathCount: 1, horizon: 10, values: Array(11).fill(-1) },
    ]) assert.equal(resolveSimulationFanPathSource({ ...execution, displayPaths }).kind, "sample");
  });
  it("renders a thousand paths with one canvas and bounded accessible controls", async () => {
    const [provider, fan] = await importUiWithPorts([
      "src/components/i18n/locale-provider.tsx",
      "src/components/simulation/simulation-fan-explorer.tsx",
    ], {});
    const render = (value) => renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale: "en" }, React.createElement(fan.SimulationFanExplorer, { execution: value })));
    const markup = render({ ...execution, assumptions: { horizon: 1 }, displayPaths: {
      pathCount: 1000, horizon: 1, values: Array.from({ length: 1000 }, (_, path) => [100, 90 + path * .02]).flat(),
    } });
    assert.match(markup, /data-fan-mode="paths"/);
    assert.match(markup, /All 1,000 paths/);
    assert.equal((markup.match(/<canvas/g) ?? []).length, 1);
    assert.match(markup, /data-rendered-path-count="1000"/);
    assert.ok((markup.match(/<button/g) ?? []).length < 12);
    assert.doesNotMatch(markup, /<pattern|<circle/);
    assert.match(markup, /aria-label="Path number"/);
    assert.match(markup, /Use left and right arrows for time/);
    const samples = render(execution);
    assert.match(samples, /Sample 1 paths/);
    assert.doesNotMatch(samples, /All 1,000 paths|data-fan-path-coverage="all"/);
  });
  it("converts normalized index to return without changing the underlying data", () => {
    assert.equal(simulationReturnLabel(110), "+10.0%");
    assert.equal(simulationReturnLabel(80), "-20.0%");
    assert.equal(simulationReturnLabel(100), "0.0%");
    assert.equal(bands[2].p50, 109);
  });
  it("keeps the scrubber input independent from sparse chart observations", () => {
    const source = readFileSync(
      "src/components/simulation/simulation-fan-explorer.tsx",
      "utf8",
    );
    assert.match(
      source,
      /value=\{Math\.round\(activeStep \?\? execution\.assumptions\.horizon\)\}/,
    );
    assert.match(
      source,
      /onInput=\{\(event\) => setActiveStep\(Number\(event\.currentTarget\.value\)\)\}/,
    );
    assert.match(
      source,
      /onFocus=\{\(event\) => setActiveStep\(Number\(event\.currentTarget\.value\)\)\}/,
    );
  });
  it("keeps preview data development-only and retains production tenant guards", () => {
    const source = readFileSync("src/app/simulation/page.tsx", "utf8");
    assert.match(
      source,
      /process\.env\.NODE_ENV === "development" && previewParams\?\.preview === "design"/,
    );
    assert.ok(
      source.indexOf("if (!resolution.ok)") <
        source.indexOf("const ownerResearchPromise"),
    );
  });
  it("retains query selections and keeps focused analysis in history-aware dialogs", () => {
    const controls = readFileSync(
      "src/components/simulation/simulation-query-controls.tsx",
      "utf8",
    );
    const workspace = readFileSync(
      "src/components/simulation/simulation-workspace.tsx",
      "utf8",
    );
    for (const key of [
      "view",
      "end",
      "horizon",
      "kodexWeight",
      "researchUniverse",
      "preview",
    ]) {
      assert.ok(controls.includes(JSON.stringify(key)));
    }
    assert.match(controls, /scroll=\{false\}/);
    assert.match(workspace, /useResearchPanelNavigation/);
    assert.match(workspace, /<RemotePanel/);
    assert.doesNotMatch(workspace, /router\.push|loadedPanel/);
    assert.match(workspace, /<dialog/);
    const resource = readFileSync("src/components/investment-lab/research-detail-resource.tsx", "utf8");
    assert.match(resource, /useSearchParams/);
    assert.match(resource, /window\.history\.pushState/);
    assert.match(resource, /window\.history\.replaceState/);
    assert.match(workspace, /data-simulation-workspace="integrated"/);
    assert.doesNotMatch(workspace, /role="tablist"/);
  });
  it("keeps the portfolio probability chart as the dominant simulation visual", () => {
    const source = readFileSync(
      "src/components/simulation/owner-research-execution-section.tsx",
      "utf8",
    );
    assert.match(source, /<ResearchFanChart large execution=\{execution\} \/>/);
    assert.doesNotMatch(source, /<ResearchFanChart compact/);
  });
});
