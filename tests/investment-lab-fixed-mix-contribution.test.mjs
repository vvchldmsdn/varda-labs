import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createInvestmentLabContributionScenarioEvidence } from "../src/lib/investment-lab-contribution-experiment.ts";
import {
  calculateInvestmentLabFixedMixContribution,
  createInvestmentLabFixedMixContributionEvidence,
  INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY,
} from "../src/lib/investment-lab-fixed-mix-contribution.ts";

describe("investment lab fixed-mix historical contribution", () => {
  it("splits principal exactly and holds both fractional lots without rebalancing", () => {
    const evidence = fixedMixEvidence({
      kodexWeightBps: 2500,
      vooWeightBps: 7500,
    });
    assert.ok(evidence);

    const result = calculateInvestmentLabFixedMixContribution({
      evidence,
      contributionServiceDate: "2026-01-05",
      contributionAmountKrw: 100_000,
    });

    assert.equal(result.status, "ready");
    assert.equal(
      result.allocation.kodexAmountKrw + result.allocation.vooAmountKrw,
      result.contributionAmountKrw,
    );
    assert.ok(closeTo(result.allocation.kodexAmountKrw, 25_000));
    assert.ok(closeTo(result.allocation.vooAmountKrw, 75_000));
    assert.ok(closeTo(result.allocation.kodexEndValueKrw, 31_250));
    assert.ok(closeTo(result.allocation.vooEndValueKrw, 87_500));
    assert.ok(closeTo(result.additionalEndValueKrw, 118_750));
    assert.ok(closeTo(result.additionalProfitKrw, 18_750));
    assert.ok(closeTo(result.additionalReturn, 0.1875));
    assert.ok(closeTo(result.baseEndValueKrw, 1_162.5));
    assert.ok(closeTo(result.projectedEndValueKrw, 119_912.5));
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].additionalValueKrw, 100_000);
  });

  it("requires both complete legs on the exact same observation axis", () => {
    const scenarios = componentScenarios();
    const weights = { kodexWeightBps: 5000, vooWeightBps: 5000 };

    assert.equal(
      createInvestmentLabFixedMixContributionEvidence({
        scenarios: scenarios.slice(0, 1),
        weights,
      }),
      null,
    );

    const mismatchedVoo = {
      ...scenarios[1],
      points: scenarios[1].points.map((point, index) =>
        index === 1 ? { ...point, serviceDate: "2026-01-07" } : point,
      ),
    };
    assert.equal(
      createInvestmentLabFixedMixContributionEvidence({
        scenarios: [scenarios[0], mismatchedVoo],
        weights,
      }),
      null,
    );

    assert.equal(
      createInvestmentLabFixedMixContributionEvidence({
        scenarios,
        weights: { kodexWeightBps: 10_001, vooWeightBps: -1 },
      }),
      null,
    );
  });

  it("blocks invalid amounts and unavailable dates without partial rows", () => {
    const evidence = fixedMixEvidence();
    assert.ok(evidence);

    const invalidAmount = calculateInvestmentLabFixedMixContribution({
      evidence,
      contributionServiceDate: "2026-01-02",
      contributionAmountKrw: 1.5,
    });
    assert.equal(invalidAmount.status, "blocked");
    assert.deepEqual(invalidAmount.blockers, ["invalid_contribution_amount"]);
    assert.deepEqual(invalidAmount.rows, []);

    const missingDate = calculateInvestmentLabFixedMixContribution({
      evidence,
      contributionServiceDate: "2026-01-04",
      contributionAmountKrw: 100_000,
    });
    assert.equal(missingDate.status, "blocked");
    assert.deepEqual(missingDate.blockers, ["contribution_date_unavailable"]);
    assert.deepEqual(missingDate.rows, []);

    const invalidWeight = calculateInvestmentLabFixedMixContribution({
      evidence: {
        ...evidence,
        weights: { kodexWeightBps: 0, vooWeightBps: 10_000 },
      },
      contributionServiceDate: "2026-01-02",
      contributionAmountKrw: 100_000,
    });
    assert.equal(invalidWeight.status, "blocked");
    assert.deepEqual(invalidWeight.blockers, ["invalid_weight_selection"]);
    assert.deepEqual(invalidWeight.rows, []);
  });

  it("stays client-memory-only and outside allocation or execution authority", () => {
    const pureSource = [
      "src/lib/investment-lab-fixed-mix-contribution.ts",
      "src/lib/investment-lab-fixed-mix-contribution-types.ts",
    ]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    const componentSource = readFileSync(
      "src/components/investment-lab/investment-lab-contribution-experiment.tsx",
      "utf8",
    );

    assert.equal(
      INVESTMENT_LAB_FIXED_MIX_CONTRIBUTION_POLICY.persistence,
      "none_client_memory_only",
    );
    assert.doesNotMatch(
      pureSource,
      /server-only|@\/db|drizzle|neon|process\.env|\bfetch\s*\(|\/api\//,
    );
    assert.doesNotMatch(
      pureSource,
      /additional-contribution-allocator|target-policy-resolver|ma120|optimizer|order/i,
    );
    assert.doesNotMatch(
      pureSource,
      /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate)\b/i,
    );
    assert.match(componentSource, /^\"use client\";/);
    assert.match(componentSource, /data-contribution-fixed-mix-status/);
    assert.match(componentSource, /calculateInvestmentLabFixedMixContribution/);
    assert.doesNotMatch(componentSource, /\bfetch\s*\(|\/api\//);
  });
});

function fixedMixEvidence(
  weights = { kodexWeightBps: 5000, vooWeightBps: 5000 },
) {
  return createInvestmentLabFixedMixContributionEvidence({
    scenarios: componentScenarios(),
    weights,
  });
}

function componentScenarios() {
  const kodex = createInvestmentLabContributionScenarioEvidence({
    scenarioId: "kodex200",
    priceBasis: "adjusted_close_krw",
    points: points([100, 120, 150], [1_000, 1_200, 1_500]),
  });
  const voo = createInvestmentLabContributionScenarioEvidence({
    scenarioId: "voo",
    priceBasis: "raw_close_usd_times_stored_snapshot_fx",
    points: points([200, 180, 210], [1_000, 900, 1_050]),
  });
  assert.ok(kodex);
  assert.ok(voo);
  return [kodex, voo];
}

function points(unitValues, baseValues) {
  return ["2026-01-02", "2026-01-05", "2026-01-06"].map(
    (serviceDate, index) => ({
      serviceDate,
      valuationPriceDate: serviceDate,
      unitValueKrw: unitValues[index],
      baseScenarioValueKrw: baseValues[index],
    }),
  );
}

function closeTo(actual, expected, epsilon = 1e-8) {
  return Math.abs(actual - expected) <= epsilon;
}
