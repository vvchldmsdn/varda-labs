import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY,
  summarizeSimulationTerminalDownsideTail,
} from "../src/lib/simulation-terminal-downside-tail.ts";

describe("Simulation terminal downside-tail summary v1", () => {
  it("calculates P5 and the exact lowest-25 mean over 500 paths", () => {
    const terminalReturns = Array.from(
      { length: 500 },
      (_, index) => (index - 250) / 1_000,
    ).reverse();
    const before = [...terminalReturns];

    const result = summarizeSimulationTerminalDownsideTail({ terminalReturns });

    assert.equal(result.summaryStatus, "ready");
    assert.equal(result.pathCount, 500);
    assert.equal(result.tailPathCount, 25);
    assert.ok(Math.abs(result.p5TerminalReturn - -0.22505) < 1e-12);
    assert.ok(
      Math.abs(result.lowerTailMeanTerminalReturn - -0.238) < 1e-12,
    );
    assert.deepEqual(terminalReturns, before);
  });

  it("uses exactly 25 rows without expanding a tie at the boundary", () => {
    const terminalReturns = [
      ...Array.from({ length: 30 }, () => -0.2),
      ...Array.from({ length: 470 }, () => 0.1),
    ];

    const result = summarizeSimulationTerminalDownsideTail({ terminalReturns });

    assert.equal(result.summaryStatus, "ready");
    assert.equal(result.tailPathCount, 25);
    assert.equal(result.p5TerminalReturn, -0.2);
    assert.equal(result.lowerTailMeanTerminalReturn, -0.2);
  });

  it("preserves signed gains when every terminal path finishes above one", () => {
    const terminalReturns = Array.from(
      { length: 500 },
      (_, index) => 0.01 + index / 100_000,
    );

    const result = summarizeSimulationTerminalDownsideTail({ terminalReturns });

    assert.equal(result.summaryStatus, "ready");
    assert.ok(result.p5TerminalReturn > 0);
    assert.ok(result.lowerTailMeanTerminalReturn > 0);
    assert.ok(
      result.lowerTailMeanTerminalReturn <= result.p5TerminalReturn,
    );
  });

  it("blocks any denominator other than the complete 500-path policy", () => {
    for (const pathCount of [0, 499, 501]) {
      const result = summarizeSimulationTerminalDownsideTail({
        terminalReturns: Array.from({ length: pathCount }, () => 0),
      });
      assertBlocked(result, ["invalid_path_count"]);
    }
  });

  it("blocks non-finite and impossible terminal returns", () => {
    for (const invalidValue of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const terminalReturns = Array.from({ length: 500 }, () => 0);
      terminalReturns[123] = invalidValue;
      assertBlocked(
        summarizeSimulationTerminalDownsideTail({ terminalReturns }),
        ["invalid_terminal_return"],
      );
    }
  });

  it("publishes the fixed tail, sign, tie, and denominator semantics", () => {
    assert.equal(
      SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.version,
      "simulation_terminal_downside_tail_summary_v1",
    );
    assert.equal(
      SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.requiredPathCount,
      500,
    );
    assert.equal(
      SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.tailPathCount,
      25,
    );
    assert.equal(
      SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.tiePolicy,
      "fixed_rank_count_without_boundary_expansion_v1",
    );
    assert.equal(
      SIMULATION_TERMINAL_DOWNSIDE_TAIL_POLICY.signConvention,
      "signed_return_negative_is_loss_v1",
    );
  });
});

function assertBlocked(result, reasons) {
  assert.equal(result.summaryStatus, "blocked");
  assert.deepEqual(
    result.blockers.map((blocker) => blocker.reason),
    reasons,
  );
  assert.equal(result.pathCount, 0);
  assert.equal(result.tailPathCount, 0);
  assert.equal(result.p5TerminalReturn, null);
  assert.equal(result.lowerTailMeanTerminalReturn, null);
}
