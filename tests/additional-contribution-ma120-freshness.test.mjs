import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateAdditionalContributionMa120OperationalEvidence as evaluate } from "../src/lib/additional-contribution-ma120-operational-evidence.ts";
import { calculateExplainableAdditionalContribution } from "../src/lib/additional-contribution-policy-engine.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const now = new Date("2026-09-09T06:00:00Z");
const key = "korea:KRW:069500";
const fixture = (overrides = {}) => ({ instrumentKey: key, asOfPriceDate: "2026-09-08", comparisonPrice: 95,
  comparisonPriceAsOf: "2026-09-09T05:00:00Z", evaluatedAt: now,
  priceBasis: "private_kis_raw_close", observations: observations("2026-09-08"), ...overrides });

describe("operational MA120 evidence freshness", () => {
  it("uses an explicit evaluation instant and distinct past dates without calendar filling", () => {
    const result = evaluate(fixture());
    assert.equal(result.status, "below_ma");
    assert.equal(result.comparisonPriceAgeHours, 1);
    assert.equal(result.historyAgeCalendarDays, 1);
    assert.equal(result.evaluatedAt, now.toISOString());
    assert.equal(result.usedObservationCount, 120);
    assert.equal(result.ma120, 100);
  });

  it("admits the documented freshness boundary and rejects the next stale day", () => {
    const boundary = evaluate(fixture({ observations: observations("2026-09-02"), comparisonPriceAsOf: "2026-09-02T06:00:00Z" }));
    assert.equal(boundary.status, "below_ma");
    assert.equal(boundary.comparisonPriceAgeHours, 168);
    assert.equal(boundary.historyAgeCalendarDays, 7);
    const stale = evaluate(fixture({ observations: observations("2026-09-01"), comparisonPriceAsOf: "2026-09-02T05:59:59.999Z" }));
    assert.equal(stale.status, "invalid_history");
    assert.deepEqual(stale.blockers, ["stale_comparison_price", "stale_history"]);
    assert.equal(stale.ma120, null);
    assert.equal(stale.distanceFromMaPct, null);
    assert.equal(stale.latestWindowPriceDate, "2026-09-01");
  });

  for (const [label, overrides, blocker] of [
    ["missing quote time", { comparisonPriceAsOf: null }, "comparison_price_time_missing"],
    ["missing runtime quote time", { comparisonPriceAsOf: undefined }, "comparison_price_time_missing"],
    ["date-only quote", { comparisonPriceAsOf: "2026-09-09" }, "invalid_comparison_price_time"],
    ["local quote time", { comparisonPriceAsOf: "2026-09-09T06:00:00" }, "invalid_comparison_price_time"],
    ["invalid calendar quote time", { comparisonPriceAsOf: "2026-02-30T06:00:00Z" }, "invalid_comparison_price_time"],
    ["future quote", { comparisonPriceAsOf: "2026-09-09T06:00:00.001Z" }, "future_comparison_price"],
    ["future history cutoff", { asOfPriceDate: "2026-09-10" }, "future_as_of_price_date"],
    ["invalid evaluation instant", { evaluatedAt: "bad" }, "invalid_evaluation_time"],
  ]) {
    it(`fails closed for ${label} without reducing the target`, () => {
      const evidence = evaluate(fixture(overrides));
      assert.equal(evidence.status, "invalid_history");
      assert.ok(evidence.blockers.includes(blocker));
      assert.equal(evidence.distanceFromMaPct, null);
      const result = policy(evidence);
      assert.equal(result.status, "ready");
      assert.ok(result.rows.every(row => row.maEffectiveMultiplier === 1));
      assert.equal(result.totalAllocatedKrw + result.residualCashKrw, result.totalAvailableFundsKrw);
    });
  }

  it("excludes future observations without letting them change a valid past window", () => {
    const baseline = evaluate(fixture());
    const result = evaluate(fixture({ observations: [...observations("2026-09-08"), { priceDate: "2026-09-10", price: 999999 }] }));
    assert.equal(result.status, baseline.status);
    assert.equal(result.ma120, baseline.ma120);
    assert.equal(result.latestWindowPriceDate, "2026-09-08");
    assert.equal(result.ignoredFutureObservationCount, 1);
  });

  it("uses today's KST date for age rather than the prior snapshot date", () => {
    const result = evaluate(fixture({ evaluatedAt: "2026-09-08T15:01:00Z", comparisonPriceAsOf: "2026-09-08T15:00:00Z", observations: observations("2026-09-01") }));
    assert.equal(result.historyAgeCalendarDays, 8);
    assert.ok(result.blockers.includes("stale_history"));
  });

  it("preserves freshness blockers at the actual shared-history query boundary", async () => {
    const calls = [];
    const history = observations("2026-09-08").map(row => ({ ...row, market: "korea", currency: "KRW", ticker: "069500", closePrice: row.price,
      source: "kis", providerSymbol: "069500", providerExchange: "KRX", fetchedAt: now,
      adjustedClosePrice: null, adjustedCloseBasis: null, adjustedCloseProvider: null, adjustedCloseSource: null, adjustedCloseFetchedAt: null }));
    const [query] = await importWithPorts(["src/db/queries/additional-contribution-ma120.ts"], {
      "@/db/queries/portfolio-risk": { loadPortfolioRiskPriceCandidates: async input => { calls.push(input); return history; } },
    });
    const holding = { market: "korea", currency: "KRW", ticker: "069500", currentPrice: 95, priceSource: "kis", priceAsOf: null, priceFetchedAt: now.toISOString() };
    const missing = await query.getReadOnlyTenantAdditionalContributionMa120Evidence({ holdings: [holding], serviceDate: "2026-09-08", now });
    assert.equal(missing.rows[0].unavailableReason, "comparison_price_time_missing");
    assert.equal(missing.status, "unavailable");
    assert.equal(missing.usableCount, 0);
    const stale = await query.getReadOnlyTenantAdditionalContributionMa120Evidence({ holdings: [{ ...holding, priceAsOf: "2026-09-01T06:00:00Z" }], serviceDate: "2026-09-08", now });
    assert.equal(stale.rows[0].unavailableReason, "stale_comparison_price");
    const fresh = await query.getReadOnlyTenantAdditionalContributionMa120Evidence({ holdings: [{ ...holding, priceAsOf: "2026-09-09T05:00:00Z" }], serviceDate: "2026-09-08", now });
    assert.equal(fresh.rows[0].status, "below_ma");
    assert.equal(fresh.status, "ready");
    assert.ok(calls.every(input => input.sourceDateTo === "2026-09-08"));
    assert.deepEqual(calls[0].tickers, ["069500"]);
  });
});

function observations(lastDate) {
  return Array.from({ length: 120 }, (_, index) => ({
    priceDate: new Date(Date.parse(`${lastDate}T00:00:00Z`) - (119 - index) * 86400000).toISOString().slice(0, 10), price: 100,
  }));
}
function policy(evidence) {
  return calculateExplainableAdditionalContribution({ cashAmountKrw: 10000, trimDriftThresholdPct: 12, minimumExecutionRatioPct: 85,
    rows: ["a", "b"].map(allocationKey => ({ allocationKey, currentValueKrw: 10000, costBasisKrw: null, targetWeightBps: 5000,
      maAssetClass: "thematic", assetType: "etf", maRuleEnabled: true, buyable: true, ma120Evidence: evidence, metadata: {} })) });
}
