import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  calculateInvestmentLabEtfShock,
  INVESTMENT_LAB_ETF_SHOCK_POLICY,
} from "../src/lib/investment-lab-etf-shock.ts";

describe("investment lab ETF single-name shock", () => {
  it("combines direct and ETF look-through exposure without renormalizing", () => {
    const result = calculateInvestmentLabEtfShock({
      component: component({
        valuedSubsetExposurePct: 35,
        directValuedSubsetWeightPct: 10,
      }),
      valuedSubsetCurrentValueKrw: 1_000_000,
      shockPct: -20,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.etfThroughExposurePct, 35);
    assert.equal(result.directExposurePct, 10);
    assert.equal(result.coveredExposurePct, 45);
    assert.equal(result.estimatedValuedSubsetChangePercentagePoints, -9);
    assert.equal(result.estimatedChangeKrw, -90_000);
    assert.equal(result.estimatedPostShockValueKrw, 910_000);
  });

  it("preserves mixed evidence dates and leaves uncovered exposure outside the factor", () => {
    const result = calculateInvestmentLabEtfShock({
      component: component({
        valuedSubsetExposurePct: 20,
        directValuedSubsetWeightPct: 0,
        asOfDates: ["2026-06-30", "2026-07-01"],
      }),
      valuedSubsetCurrentValueKrw: 2_000_000,
      shockPct: -10,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.mixedAsOfDates, true);
    assert.deepEqual(result.asOfDates, ["2026-06-30", "2026-07-01"]);
    assert.equal(result.estimatedValuedSubsetChangePercentagePoints, -2);
    assert.equal(result.estimatedChangeKrw, -40_000);
  });

  it("blocks out-of-range shocks and invalid exposure totals without partial results", () => {
    for (const shockPct of [-100.1, 100.1, Number.NaN]) {
      const result = calculateInvestmentLabEtfShock({
        component: component({}),
        valuedSubsetCurrentValueKrw: 1_000_000,
        shockPct,
      });
      assert.equal(result.status, "blocked");
      assert.deepEqual(result.blockers, ["invalid_shock_percentage"]);
      assert.equal("estimatedChangeKrw" in result, false);
    }

    const invalidExposure = calculateInvestmentLabEtfShock({
      component: component({
        valuedSubsetExposurePct: 70,
        directValuedSubsetWeightPct: 40,
      }),
      valuedSubsetCurrentValueKrw: 1_000_000,
      shockPct: -10,
    });
    assert.equal(invalidExposure.status, "blocked");
    assert.deepEqual(invalidExposure.blockers, ["invalid_exposure_total"]);
  });

  it("keeps the calculator and client interaction outside persistence and recommendation authority", () => {
    const calculatorSource = readFileSync(
      "src/lib/investment-lab-etf-shock.ts",
      "utf8",
    );
    const componentSource = readFileSync(
      "src/components/investment-lab/investment-lab-etf-shock.tsx",
      "utf8",
    );

    assert.equal(
      INVESTMENT_LAB_ETF_SHOCK_POLICY.persistence,
      "none_client_memory_only",
    );
    for (const source of [calculatorSource, componentSource]) {
      assert.doesNotMatch(source, /server-only|@\/db|drizzle|neon|process\.env/);
      assert.doesNotMatch(source, /\bfetch\s*\(|\/api\//);
      assert.doesNotMatch(source, /optimizer|recommendation|order-authority/i);
      assert.doesNotMatch(
        source,
        /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|truncate)\b/i,
      );
    }
  });
});

function component(overrides) {
  return {
    name: "Holding X",
    symbol: "X",
    market: "us",
    currency: "USD",
    valuedSubsetExposurePct: 35,
    directValuedSubsetWeightPct: 10,
    throughEtfCount: 2,
    throughEtfs: ["ETF A", "ETF B"],
    asOfDates: ["2026-07-01"],
    hasDirectOverlap: true,
    hasMultiEtfOverlap: true,
    ...overrides,
  };
}
