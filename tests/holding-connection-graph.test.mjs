import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, useId } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { translateHomeHistory } from "../src/components/home/home-history-messages.ts";

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
    assert.equal(graph.emptyReason, null);
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
    assert.equal(graph.emptyReason, "insufficient_personal_history");
  });

  it("distinguishes enough weakly correlated records from missing personal history", () => {
    const graph = buildHoldingConnectionGraph({ dates: dates(6), rows: [
      historyRow("a", "Alpha", 60, [-3, -2, -1, 1, 2, 3]),
      historyRow("b", "Beta", 40, [1, -1, 0, 0, -1, 1]),
    ], observedCellCount: 12, expectedCellCount: 12, coveragePct: 100 });
    assert.equal(graph.nodes.length, 2); assert.equal(graph.edges.length, 0);
    assert.equal(graph.emptyReason, "no_strong_connection");
  });

  it("does not describe constant observed returns as missing history or as zero correlation", () => {
    const graph = buildHoldingConnectionGraph({ dates: dates(6), rows: [
      historyRow("a", "Alpha", 60, [1, 1, 1, 1, 1, 1]),
      historyRow("b", "Beta", 40, [1, 2, 3, 4, 5, 6]),
    ], observedCellCount: 12, expectedCellCount: 12, coveragePct: 100 });
    assert.equal(graph.edges.length, 0); assert.equal(graph.emptyReason, "insufficient_variation");
  });

  it("does not mix today's native price returns into saved KRW unit-value correlations", () => {
    const rows = [historyRow("a", "Alpha", 60, [1, 2, 3, 4, 5, 6]), historyRow("b", "Beta", 40, [2, 4, 6, 8, 10, 12])];
    rows[0].cells.push({ ...rows[0].cells[0], date: "2026-08-07", changePct: 50, basis: "live_price" });
    rows[1].cells.push({ ...rows[1].cells[0], date: "2026-08-07", changePct: -50, basis: "live_price" });
    const graph = buildHoldingConnectionGraph({ dates: dates(7), rows, observedCellCount: 14, expectedCellCount: 14, coveragePct: 100 });
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].observations, 6);
    assert.ok(Math.abs(graph.edges[0].correlation - 1) < 1e-12);
  });

  it("renders honest Korean and English empty states while retaining access to shared-market analysis", async () => {
    let locale = "ko";
    const [ui] = await importUiWithPorts(["src/components/home/holding-movement-heatmap.tsx"], {
      react: { useId, useMemo: fn => fn(), useEffect: () => {}, useRef: current => ({ current }), useState: initial => [initial === "movement" ? "connections" : initial, () => {}] },
      "next/link": { default: ({ children, ...props }) => createElement("a", props, children) },
      "@/components/i18n/locale-provider": { useI18n: () => ({ locale, t: (ko, en) => locale === "ko" ? ko : en }) },
      "@/components/i18n/localized-text": { T: ({ ko, en }) => locale === "ko" ? ko : en },
    });
    const history = rows => ({ dates: dates(6), rows, observedCellCount: 0, expectedCellCount: 12, coveragePct: 0 });
    const insufficient = history([historyRow("a", "Alpha", 60, []), historyRow("b", "Beta", 40, [])]);
    const weak = history([historyRow("a", "Alpha", 60, [-3, -2, -1, 1, 2, 3]), historyRow("b", "Beta", 40, [1, -1, 0, 0, -1, 1])]);
    const render = value => renderToStaticMarkup(createElement(ui.HoldingMovementHeatmap, { history: value, riskHref: "/portfolio/risk?scope=all", structureHref: "/portfolio/structure" }));
    for (const selected of ["ko", "en"]) {
      locale = selected;
      const pending = render(insufficient), unrelated = render(weak);
      assert.match(pending, /data-connection-empty="insufficient_personal_history"/);
      assert.ok(pending.includes(locale === "ko" ? "개인 일별 기록을 쌓고 있어요." : "Your daily portfolio records are building up."));
      assert.ok(pending.includes(locale === "ko" ? "공유 시장 이력" : "shared market history"));
      assert.match(pending, /href="\/portfolio\/risk\?scope=all"/);
      assert.match(unrelated, /data-connection-empty="no_strong_connection"/);
      assert.ok(unrelated.includes(locale === "ko" ? "공통 기록은 충분하지만" : "There are enough matching records"));
    }
    assert.equal(translateHomeHistory("변동 비교 근거"), "Change comparison coverage");
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
