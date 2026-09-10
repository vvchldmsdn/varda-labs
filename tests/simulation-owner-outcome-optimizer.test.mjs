import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";

import {
  buildSimulationOwnerOutcomeCandidates,
  searchSimulationOwnerOutcomeCandidatesFromTerminalGrowth,
  SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY,
} from "../src/lib/simulation-owner-outcome-optimizer.ts";
import { prepareSimulationResearchPaths } from "../src/lib/simulation-research-execution-core.ts";
import {
  ownerWeights,
  readyOwnerMatrix,
} from "./support/simulation-owner-ready-matrix.mjs";

describe("owner simulation outcome candidate search", () => {
  it("matches the original full-evaluation search exactly, including ties and rounding-close changes", async () => {
    const reference = await fullEvaluationReference();
    for (const mode of ["varied", "ties", "rounding", "large"]) {
      const input = terminalFixture(mode);
      const unchanged = structuredClone(input);
      const actual = searchSimulationOwnerOutcomeCandidatesFromTerminalGrowth(input);
      const expected = reference.searchSimulationOwnerOutcomeCandidatesFromTerminalGrowth(input);
      assert.deepEqual(actual, expected, mode);
      assert.deepEqual(input, unchanged, `${mode}: inputs remain unchanged`);
    }
  });

  it("finds deterministic candidates that improve on held-out paths within every guardrail", () => {
    const prepared = readyPrepared();
    const currentWeights = ownerWeights([5_000, 2_500, 2_500]);
    const first = buildSimulationOwnerOutcomeCandidates({
      prepared,
      currentWeights,
    });
    const second = buildSimulationOwnerOutcomeCandidates({
      prepared,
      currentWeights,
    });

    assert.equal(first.status, "ready");
    assert.deepEqual(second, first);
    assert.ok(first.candidates.length >= 2);
    for (const candidate of first.candidates) {
      assert.equal(
        candidate.weights.reduce(
          (sum, row) => sum + row.candidateWeightBps,
          0,
        ),
        10_000,
      );
      assert.ok(candidate.constraints.oneWayTurnoverBps <= 2_000);
      assert.ok(candidate.constraints.fxExposureChangeBps <= 1_000);
      assert.ok(
        candidate.weights.every(
          (row) =>
            row.candidateWeightBps <=
            candidate.constraints.maximumInstrumentWeightBps,
        ),
      );
      assert.ok(candidate.search.objectiveImprovementPctPoints > 0);
      assert.ok(candidate.confirmation.objectiveImprovementPctPoints > 0);
      assert.equal(candidate.search.pathCount, 250);
      assert.equal(candidate.confirmation.pathCount, 250);
    }
    assert.equal(first.policy.persistence, "forbidden");
    assert.equal(first.policy.recommendation, "forbidden");
    assert.equal(first.policy.orderAuthority, "forbidden");
  });

  it("does not let confirmation-path values choose the candidate weights", () => {
    const prepared = readyPrepared();
    const changed = {
      ...prepared,
      grossGrowth: {
        ...prepared.grossGrowth,
        paths: prepared.grossGrowth.paths.map((path, index) =>
          index % 2 === 0
            ? path
            : {
                ...path,
                points: path.points.map((point, pointIndex) =>
                  pointIndex !== path.points.length - 1
                    ? point
                    : {
                        ...point,
                        grossGrowthFactors: point.grossGrowthFactors.map(
                          (factor) => ({
                            ...factor,
                            value: factor.value * 1.01,
                          }),
                        ),
                      },
                ),
              },
        ),
      },
    };
    const currentWeights = ownerWeights([5_000, 2_500, 2_500]);
    const baseline = buildSimulationOwnerOutcomeCandidates({
      prepared,
      currentWeights,
    });
    const withChangedConfirmation = buildSimulationOwnerOutcomeCandidates({
      prepared: changed,
      currentWeights,
    });

    assert.equal(baseline.status, "ready");
    assert.equal(withChangedConfirmation.status, "ready");
    assert.deepEqual(
      withChangedConfirmation.candidates.map((candidate) => ({
        objective: candidate.objective,
        weights: candidate.weights.map((row) => row.candidateWeightBps),
      })),
      baseline.candidates.map((candidate) => ({
        objective: candidate.objective,
        weights: candidate.weights.map((row) => row.candidateWeightBps),
      })),
    );
  });

  it("does not invent alternatives for a one-instrument account", () => {
    const prepared = prepareSimulationResearchPaths({
      matrix: readyOwnerMatrix({ instrumentCount: 1 }),
      seed: 0x56415244,
      expectedBlockLength: 5,
      horizon: 63,
      pathCount: 500,
    });
    assert.equal(prepared.status, "ready");

    const result = buildSimulationOwnerOutcomeCandidates({
      prepared,
      currentWeights: ownerWeights([10_000], 1),
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_shape_mismatch");
    assert.deepEqual(result.candidates, []);
    assert.deepEqual(
      SIMULATION_OWNER_OUTCOME_OPTIMIZER_POLICY.coordinateTransferStepsBps,
      [500, 250, 100],
    );
  });
});

function readyPrepared() {
  const prepared = prepareSimulationResearchPaths({
    matrix: readyOwnerMatrix(),
    seed: 0x56415244,
    expectedBlockLength: 5,
    horizon: 63,
    pathCount: 500,
  });
  assert.equal(prepared.status, "ready");
  return prepared;
}

function terminalFixture(mode) {
  const instruments = Array.from({ length: 8 }, (_, i) => ({
    instrumentKey: `${i % 2 ? "us|USD" : "korea|KRW"}|T${i}`,
    market: i % 2 ? "us" : "korea", currency: i % 2 ? "USD" : "KRW", ticker: `T${i}`,
  }));
  return {
    instruments,
    currentWeights: instruments.map(row => ({ ...row, weightBps: 1250 })),
    terminalFactors: Array.from({ length: 40 }, (_, pathIndex) => ({
      pathIndex,
      factors: instruments.map((_, asset) => {
        if (mode === "rounding") return 1 + ((asset * 13 + pathIndex * 7) % 41) * 1e-14;
        if (mode === "large") return 1e12 + ((asset * 13 + pathIndex * 7) % 41) * .0001;
        return (95 + ((mode === "ties" ? Math.floor(asset / 2) : asset) * 13 + pathIndex * 7) % 41) / 100 + ((pathIndex % 7) - 3) * .0001;
      }),
    })),
  };
}

async function fullEvaluationReference() {
  // Disable only the new screening estimate. The reference therefore evaluates
  // every feasible transfer with the pre-optimization full evaluator, retaining
  // its floating-point results, constraints and lexicographic tie rules.
  const sourceUrl = new URL("../src/lib/simulation-owner-outcome-optimizer.ts", import.meta.url);
  const source = readFileSync(sourceUrl, "utf8");
  const fullSource = source.replace(/const estimate = estimateTransferScore\(\{[\s\S]*?\}\);/, "const estimate = null;");
  assert.notEqual(fullSource, source, "reference must disable transfer screening");
  const compiled = ts.transpileModule(fullSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace(/from (["'])(\.{1,2}\/[^"']+)\1/g, (_, quote, path) => `from ${quote}${new URL(path, sourceUrl).href}${quote}`);
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
