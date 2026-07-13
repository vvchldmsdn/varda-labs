import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  calculateInvestmentLabContributionExperiment,
  createInvestmentLabContributionScenarioEvidence,
  INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY,
} from "../src/lib/investment-lab-contribution-experiment.ts";

describe("investment lab historical contribution experiment", () => {
  it("tracks a fractional KODEX 200 contribution lot without changing the base path", () => {
    const scenario = createInvestmentLabContributionScenarioEvidence({
      scenarioId: "kodex200",
      priceBasis: "adjusted_close_krw",
      points: points([100, 110, 121], [1_000_000, 1_100_000, 1_210_000]),
    });
    assert.ok(scenario);

    const result = calculateInvestmentLabContributionExperiment({
      scenario,
      contributionServiceDate: "2026-01-05",
      contributionAmountKrw: 100_000,
    });

    assert.equal(result.status, "ready");
    assert.ok(closeTo(result.additionalUnits, 100_000 / 110));
    assert.ok(closeTo(result.additionalEndValueKrw, 110_000));
    assert.ok(closeTo(result.additionalProfitKrw, 10_000));
    assert.ok(closeTo(result.additionalReturn, 0.1));
    assert.ok(closeTo(result.baseEndValueKrw, 1_210_000));
    assert.ok(closeTo(result.projectedEndValueKrw, 1_320_000));
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].additionalValueKrw, 100_000);
    assert.equal(scenario.points.at(-1).baseScenarioValueKrw, 1_210_000);
  });

  it("uses the supplied KRW unit-value evidence for VOO", () => {
    const scenario = createInvestmentLabContributionScenarioEvidence({
      scenarioId: "voo",
      priceBasis: "raw_close_usd_times_stored_snapshot_fx",
      points: points(
        [130_000, 136_500, 143_000],
        [2_000_000, 2_100_000, 2_200_000],
      ),
    });
    assert.ok(scenario);

    const result = calculateInvestmentLabContributionExperiment({
      scenario,
      contributionServiceDate: "2026-01-02",
      contributionAmountKrw: 1_000_000,
    });

    assert.equal(result.status, "ready");
    assert.ok(closeTo(result.additionalEndValueKrw, 1_100_000));
    assert.ok(closeTo(result.additionalReturn, 0.1));
    assert.equal(
      result.priceBasis,
      "raw_close_usd_times_stored_snapshot_fx",
    );
  });

  it("blocks invalid contribution amounts with no partial rows", () => {
    const scenario = validScenario();
    for (const contributionAmountKrw of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      const result = calculateInvestmentLabContributionExperiment({
        scenario,
        contributionServiceDate: "2026-01-02",
        contributionAmountKrw,
      });
      assert.equal(result.status, "blocked");
      assert.deepEqual(result.blockers, ["invalid_contribution_amount"]);
      assert.deepEqual(result.rows, []);
    }
  });

  it("requires an exact observed contribution service date", () => {
    const result = calculateInvestmentLabContributionExperiment({
      scenario: validScenario(),
      contributionServiceDate: "2026-01-04",
      contributionAmountKrw: 100_000,
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["contribution_date_unavailable"]);
    assert.deepEqual(result.rows, []);
  });

  it("rejects unordered, look-ahead, or mismatched price-basis evidence", () => {
    const invalidInputs = [
      {
        scenarioId: "kodex200",
        priceBasis: "adjusted_close_krw",
        points: [...validScenario().points].reverse(),
      },
      {
        scenarioId: "kodex200",
        priceBasis: "adjusted_close_krw",
        points: validScenario().points.map((point, index) =>
          index === 0
            ? { ...point, valuationPriceDate: "2026-01-03" }
            : point,
        ),
      },
      {
        scenarioId: "kodex200",
        priceBasis: "raw_close_usd_times_stored_snapshot_fx",
        points: validScenario().points,
      },
    ];

    for (const input of invalidInputs) {
      assert.equal(createInvestmentLabContributionScenarioEvidence(input), null);
    }
  });

  it("blocks unsafe projected currency values instead of returning a partial path", () => {
    const scenario = createInvestmentLabContributionScenarioEvidence({
      scenarioId: "kodex200",
      priceBasis: "adjusted_close_krw",
      points: points([1, 2, 3], [Number.MAX_SAFE_INTEGER - 1, 1, 1]),
    });
    assert.ok(scenario);

    const result = calculateInvestmentLabContributionExperiment({
      scenario,
      contributionServiceDate: "2026-01-02",
      contributionAmountKrw: Number.MAX_SAFE_INTEGER,
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["invalid_calculation_result"]);
    assert.deepEqual(result.rows, []);
  });

  it("keeps the calculator pure and outside target or recommendation authority", () => {
    const source = readFileSync(
      "src/lib/investment-lab-contribution-experiment.ts",
      "utf8",
    );

    assert.equal(
      INVESTMENT_LAB_CONTRIBUTION_EXPERIMENT_POLICY.persistence,
      "none_client_memory_only",
    );
    assert.doesNotMatch(source, /server-only|@\/db|drizzle|neon|process\.env/);
    assert.doesNotMatch(source, /\bfetch\s*\(|\/api\//);
    assert.doesNotMatch(
      source,
      /target-policy-resolver|additional-contribution-allocator|ma120|optimizer/i,
    );
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|truncate)\b/i,
    );
  });
});

function validScenario() {
  return createInvestmentLabContributionScenarioEvidence({
    scenarioId: "kodex200",
    priceBasis: "adjusted_close_krw",
    points: points([100, 110, 121], [1_000, 1_100, 1_210]),
  });
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

function closeTo(actual, expected, epsilon = 1e-9) {
  return Math.abs(actual - expected) <= epsilon;
}
