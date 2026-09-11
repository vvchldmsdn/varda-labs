import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeSimulationNavPaths } from "../src/lib/simulation-nav-path-summary.ts";
import { summarizeSimulationTerminalDownsideTail } from "../src/lib/simulation-terminal-downside-tail.ts";
import { executeSimulationResearchPaths } from "../src/lib/simulation-research-execution-core.ts";
import { buildSimulationOwnerCandidateComparison } from "../src/lib/simulation-owner-candidate-comparison.ts";
import { prepareSimulationResearchPaths } from "../src/lib/simulation-research-execution-core.ts";
import { SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY } from "../src/lib/simulation-owner-research-execution.ts";
import { SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY } from "../src/lib/simulation-owner-economic-research.ts";
import { SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY } from "../src/lib/simulation-owner-parametric-factor.ts";
import { ownerWeights, readyOwnerMatrix } from "./support/simulation-owner-ready-matrix.mjs";

test("1000-path summaries preserve exact statistics and expose every point only on request", () => {
  const paths = Array.from({ length: 1000 }, (_, p) => [1, 1 + (p - 500) / 4000, 1 + (p - 500) / 3000]);
  const input = { paths, horizon: 2, samplePathCount: 12 };
  const compact = summarizeSimulationNavPaths(input);
  const full = summarizeSimulationNavPaths({ ...input, includeDisplayPaths: true });
  assert.equal(compact.status, "ready");
  assert.equal(compact.displayPaths, null);
  assert.deepEqual(full.terminal, compact.terminal);
  assert.deepEqual(full.bands, compact.bands);
  assert.deepEqual(full.samplePaths, compact.samplePaths);
  assert.equal(full.terminal.lossProbabilityPct, 50);
  assert.equal(full.displayPaths.pathCount, 1000);
  assert.equal(full.displayPaths.horizon, 2);
  assert.equal(full.displayPaths.values.length, 3000);
  for (let p = 0; p < 1000; p += 1) {
    for (let step = 0; step <= 2; step += 1) {
      assert.equal(full.displayPaths.values[p * 3 + step], Number((paths[p][step] * 100).toPrecision(7)));
    }
  }
  assert.deepEqual(JSON.parse(JSON.stringify(full.displayPaths)), full.displayPaths);
  assert.ok(Object.isFrozen(full.displayPaths.values));
  assert.equal(full.samplePaths.length, 12);
  assert.equal(summarizeSimulationNavPaths({ ...input, paths: [...paths, paths[0]], includeDisplayPaths: true }).displayPaths, null);
});

test("the 1000-path downside mean uses exactly 50 returns, while legacy 500 uses 25", () => {
  for (const pathCount of [500, 1000]) {
    const returns = Array.from({ length: pathCount }, (_, p) => (p - pathCount / 2) / pathCount);
    const result = summarizeSimulationTerminalDownsideTail({ terminalReturns: returns });
    assert.equal(result.summaryStatus, "ready");
    assert.equal(result.pathCount, pathCount);
    assert.equal(result.tailPathCount, pathCount * 0.05);
    const expectedMean = returns.slice(0, pathCount * 0.05).reduce((sum, value) => sum + value, 0) / (pathCount * 0.05);
    assert.ok(Math.abs(result.lowerTailMeanTerminalReturn - expectedMean) < 1e-14);
    const summary = summarizeSimulationNavPaths({ paths: returns.map(value => [1, 1 + value]), horizon: 1, samplePathCount: 12 });
    assert.equal(summary.status, "ready");
    assert.equal(summary.terminal.lossProbabilityPct, 50);
  }
});

test("historical 1000-path execution includes the whole 126-step display series without candidate duplication", () => {
  const matrix = readyOwnerMatrix();
  const weights = ownerWeights([5000, 2500, 2500]);
  const input = { matrix, scenarioId: "display-test", scenarioVersion: "v1", weights,
    seed: 0x56415244, expectedBlockLength: 5, horizon: 126, pathCount: 1000, samplePathCount: 12 };
  const execution = executeSimulationResearchPaths({ ...input, includeDisplayPaths: true });
  assert.equal(execution.status, "ready");
  assert.equal(execution.displayPaths.values.length, 127000);
  assert.equal(execution.displayPaths.values.filter((_, index) => index % 127 === 0).every(value => value === 100), true);
  for (const path of execution.samplePaths) {
    for (const point of path.points) assert.equal(execution.displayPaths.values[path.pathIndex * 127 + point.stepIndex], Number(point.indexValue.toPrecision(7)));
  }
  const compact = executeSimulationResearchPaths(input);
  assert.equal(compact.displayPaths, null);
  assert.deepEqual(compact.terminal, execution.terminal);
  const prepared = prepareSimulationResearchPaths(input);
  const comparison = buildSimulationOwnerCandidateComparison({ account: "all", prepared,
    currentExecution: execution, currentWeights: weights, samplePathCount: 12 });
  assert.equal(comparison.status, "ready");
  assert.equal(comparison.currentExecution.displayPaths, null);
  assert.equal(comparison.candidateExecution.displayPaths, null);
  for (const candidate of comparison.outcomeCandidates) {
    assert.equal(candidate.execution.displayPaths, null);
    assert.equal(candidate.search.pathCount, 500);
    assert.equal(candidate.confirmation.pathCount, 500);
  }
  assert.ok(execution.displayPaths !== null);
});

test("owner models use the same 1000-path budget", () => {
  assert.equal(SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.pathCount, 1000);
  assert.equal(SIMULATION_OWNER_ECONOMIC_RESEARCH_POLICY.pathCount, 1000);
  assert.equal(SIMULATION_OWNER_PARAMETRIC_FACTOR_POLICY.pathCount, 1000);
});
