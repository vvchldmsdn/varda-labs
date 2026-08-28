import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { diagnoseInvestmentLabScenario } from "../src/lib/investment-lab-scenario-diagnostics.ts";

describe("investment lab unavailable scenario diagnostics", () => {
  it("turns a missing approved target into a concrete next action", () => {
    const result = diagnoseInvestmentLabScenario([
      "return_unavailable",
      "approved_target_policy_missing",
      "source_unavailable",
    ]);

    assert.match(result.reason, /승인된 목표 비중/);
    assert.match(result.resolution, /저장하고 승인/);
  });

  it("distinguishes provider evidence repair from policy setup", () => {
    const price = diagnoseInvestmentLabScenario([
      "return_unavailable",
      "scenario_price_missing",
    ]);
    const fx = diagnoseInvestmentLabScenario([
      "return_unavailable",
      "scenario_fx_duplicate",
    ]);

    assert.match(price.resolution, /provider/);
    assert.match(fx.reason, /USD\/KRW/);
  });

  it("does not recommend imputing a missing actual path", () => {
    const result = diagnoseInvestmentLabScenario([
      "return_unavailable",
      "actual_path_incomplete",
    ]);

    assert.match(result.resolution, /다른 시나리오 값으로 대신 채우지/);
  });

  it("explains insufficient continuous risk observations", () => {
    const result = diagnoseInvestmentLabScenario([
      "insufficient_volatility_periods",
    ]);

    assert.match(result.reason, /연속 일간수익률이 20개 미만/);
    assert.match(result.resolution, /20개 이상의 연속 일간수익률/);
  });
});
