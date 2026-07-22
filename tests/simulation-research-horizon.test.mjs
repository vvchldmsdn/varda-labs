import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_RESEARCH_HORIZON_POLICY,
  resolveSimulationResearchHorizon,
} from "../src/lib/simulation-research-horizon.ts";

describe("Simulation research horizon selection", () => {
  it("defaults to 63 and accepts only the two fixed research horizons", () => {
    assert.deepEqual(resolveSimulationResearchHorizon(undefined), {
      status: "valid",
      source: "default",
      horizon: 63,
    });
    assert.equal(resolveSimulationResearchHorizon("63").horizon, 63);
    assert.equal(resolveSimulationResearchHorizon("126").horizon, 126);
    assert.deepEqual(SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons, [
      63,
      126,
    ]);
  });

  it("blocks malformed, repeated, and unapproved values without fallback", () => {
    for (const value of ["", "0", "90", "63.0", ["63", "126"]]) {
      assert.deepEqual(resolveSimulationResearchHorizon(value), {
        status: "invalid",
        source: "query",
        horizon: null,
      });
    }
  });
});
