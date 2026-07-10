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
  it("uses a canonical path for the brokerage 90-day default", () => {
    assert.equal(buildPortfolioRiskHref("brokerage", 90), "/portfolio/risk");
    assert.equal(
      buildPortfolioRiskHref("isa", 90),
      "/portfolio/risk?account=isa",
    );
    assert.equal(
      buildPortfolioRiskHref("all", 252),
      "/portfolio/risk?account=all&window=252",
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
