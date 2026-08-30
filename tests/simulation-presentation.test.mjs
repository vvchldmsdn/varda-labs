import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  nearestSimulationBand,
  resolveResearchFanChartValueDomain,
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
  it("retains query selections and supports keyboard tabs without scrolling", () => {
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
    assert.match(workspace, /window\.history\.pushState/);
    for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"])
      assert.ok(workspace.includes(key));
  });
});
