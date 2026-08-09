import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY,
  parseInvestmentLabStressHistoryCommandArgs,
  planInvestmentLabStressHistoryCompletion,
} from "../src/lib/market-data/investment-lab-stress-history-completion.ts";

describe("investment lab stress history completion", () => {
  it("defaults to a provider-free and write-free plan", () => {
    assert.deepEqual(parseInvestmentLabStressHistoryCommandArgs([]), {
      mode: "plan_only",
    });
    assert.throws(
      () => parseInvestmentLabStressHistoryCommandArgs(["--write"]),
      /writes require both/,
    );
    assert.equal(
      parseInvestmentLabStressHistoryCommandArgs(["--provider-dry-run"]).mode,
      "provider_dry_run",
    );
  });

  it("splits every fixed range under the existing 180-day provider boundary", () => {
    const result = planInvestmentLabStressHistoryCompletion({
      holdings: [
        {
          accountCode: "isa",
          market: "korea",
          currency: "KRW",
          ticker: "133690",
          quantity: 1,
        },
      ],
    });

    assert.equal(result.plans.length, 5);
    assert.ok(result.plans.every(({ plan }) => plan.rangeCalendarDays <= 180));
    assert.ok(
      result.plans.every(({ plan }) =>
        plan.targets.some((target) => target.key === "korea|KRW|069500"),
      ),
    );
    assert.ok(
      result.plans.every(({ plan }) =>
        plan.targets.some((target) => target.key === "us|USD|VOO"),
      ),
    );
  });

  it("pins one provider instance and insert-missing FX semantics", () => {
    assert.equal(
      INVESTMENT_LAB_STRESS_HISTORY_COMPLETION_POLICY.providerInstanceCount,
      1,
    );
    const script = readFileSync(
      "scripts/complete-investment-lab-stress-history.ts",
      "utf8",
    );
    assert.equal((script.match(/createKisMarketDataProvider\(\)/g) ?? []).length, 1);
    assert.match(script, /existingDates\.has\(row\.rateDate\)/);
    assert.doesNotMatch(script, /retry|setTimeout|setInterval/i);
  });
});
