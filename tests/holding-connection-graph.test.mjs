import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildHoldingConnectionGraph } from "../src/lib/holding-connection-graph.ts";

describe("holding connection graph", () => {
  it("builds deterministic positive and negative correlation edges", () => {
    const graph = buildHoldingConnectionGraph({
      dates: dates(6),
      rows: [
        historyRow("a", "Alpha Fund", 50, [1, 2, 3, 4, 5, 6]),
        historyRow("b", "Beta Fund", 30, [2, 4, 6, 8, 10, 12]),
        historyRow("c", "Counter Fund", 20, [6, 5, 4, 3, 2, 1]),
      ],
      observedCellCount: 18,
      expectedCellCount: 18,
      coveragePct: 100,
    });

    assert.deepEqual(graph.nodes.map((node) => node.holdingId), ["a", "b", "c"]);
    assert.equal(graph.edges.length, 3);
    assert.equal(graph.edges[0]?.observations, 6);
    assert.ok(graph.edges.some((edge) => Math.abs(edge.correlation - 1) < 1e-12));
    assert.ok(graph.edges.some((edge) => Math.abs(edge.correlation + 1) < 1e-12));
    assert.ok(graph.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
  });

  it("does not claim a connection from fewer than six common observations", () => {
    const graph = buildHoldingConnectionGraph({
      dates: dates(5),
      rows: [
        historyRow("a", "Alpha Fund", 60, [1, 2, 3, 4, 5]),
        historyRow("b", "Beta Fund", 40, [1, 2, 3, 4, 5]),
      ],
      observedCellCount: 10,
      expectedCellCount: 10,
      coveragePct: 100,
    });

    assert.equal(graph.nodes.length, 2);
    assert.equal(graph.edges.length, 0);
  });
});

function dates(count) {
  return Array.from({ length: count }, (_, index) => `2026-08-${String(index + 1).padStart(2, "0")}`);
}

function historyRow(holdingId, name, currentWeight, values) {
  return {
    holdingId,
    name,
    ticker: holdingId.toUpperCase(),
    account: "brokerage",
    currentWeight,
    cells: values.map((changePct, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, "0")}`,
      changePct,
      changeKrw: null,
      priceChangeKrw: null,
      fxChangeKrw: null,
      basis: "unit_value",
    })),
  };
}
