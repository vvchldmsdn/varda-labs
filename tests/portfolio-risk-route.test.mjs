import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculationReasonLabel,
  formatRiskMetric,
  formatRiskRatioPercent,
  metricReasonLabel,
} from "../src/components/portfolio-risk/portfolio-risk-format.ts";
import { buildPortfolioRiskHref } from "../src/lib/portfolio-risk-route.ts";

describe("portfolio risk route presentation", () => {
  it("uses canonical dynamic scopes and preserves the risk window", () => {
    assert.equal(
      buildPortfolioRiskHref("all", 90),
      "/portfolio/risk?scope=all",
    );
    assert.equal(
      buildPortfolioRiskHref(
        "account:11111111-1111-4111-8111-111111111111",
        90,
      ),
      "/portfolio/risk?scope=account%3A11111111-1111-4111-8111-111111111111",
    );
    assert.equal(
      buildPortfolioRiskHref(
        "portfolio:22222222-2222-4222-8222-222222222222",
        252,
      ),
      "/portfolio/risk?window=252&scope=portfolio%3A22222222-2222-4222-8222-222222222222",
    );
  });

  it("never formats nullable risk metrics as a clean zero", () => {
    assert.equal(
      formatRiskMetric({ value: null, reason: "zero_variance" }),
      "n/a",
    );
    assert.equal(formatRiskRatioPercent(null), "n/a");
    assert.equal(metricReasonLabel("zero_variance"), "변동성 0");
  });

  it("keeps unavailable calculation reasons explicit", () => {
    assert.equal(
      calculationReasonLabel("input_insufficient_coverage"),
      "요청한 기간의 관측치가 부족합니다.",
    );
    assert.equal(calculationReasonLabel(null), null);
  });
});
