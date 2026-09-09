import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  HOLDING_ONBOARDING_POLICY,
  calculateLocalReturnPct,
  parseHoldingOnboardingInput,
} from "../src/lib/holding-onboarding.ts";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "22222222-2222-4222-8222-222222222222";
const writerSource = readFileSync(
  new URL("../src/lib/holding-onboarding-write.ts", import.meta.url),
  "utf8",
);
const formSource = readFileSync(
  new URL("../src/components/holding-onboarding-form.tsx", import.meta.url),
  "utf8",
);

describe("holding onboarding contract", () => {
  it("normalizes a Korean ETF with direct average cost authority", () => {
    const result = parseHoldingOnboardingInput(
      form({
        accountId: ACCOUNT_ID,
        portfolioGroupId: GROUP_ID,
        market: "KOREA",
        assetType: "ETF",
        ticker: " 069500 ",
        name: " KODEX 200 ",
        quantity: "47",
        averageCost: "115500.25",
        currentPrice: "117700",
        reportedReturnPct: "1.9045",
      }),
    );

    assert.equal(result.ok, true);
    assert.deepEqual(result.input, {
      accountId: ACCOUNT_ID,
      instrumentId: null,
      portfolioGroupId: GROUP_ID,
      newPortfolioGroupName: null,
      market: "korea",
      currency: "KRW",
      assetType: "etf",
      ticker: "069500",
      name: "KODEX 200",
      quantity: "47",
      averageCost: "115500.25",
      currentPrice: "117700",
      reportedReturnPct: "1.9045",
    });
    assert.equal(
      HOLDING_ONBOARDING_POLICY.reportedReturnRole,
      "reference_only",
    );
  });

  it("derives USD for a US holding and allows cached price selection", () => {
    const result = parseHoldingOnboardingInput(
      form({
        accountId: ACCOUNT_ID,
        newPortfolioGroupName: "장기 성장",
        market: "us",
        assetType: "stock",
        ticker: " voo ",
        quantity: "4.125",
        averageCost: "618.4321",
      }),
    );

    assert.equal(result.ok, true);
    assert.equal(result.input.currency, "USD");
    assert.equal(result.input.ticker, "VOO");
    assert.equal(result.input.currentPrice, null);
    assert.equal(result.input.reportedReturnPct, null);
  });

  it("starts without a cost or group and never infers purchase performance", () => {
    const result = parseHoldingOnboardingInput(form({
      accountId: ACCOUNT_ID, market: "us", assetType: "stock", ticker: "AAPL", quantity: "2", averageCost: "   ",
    }));
    assert.equal(result.ok, true);
    assert.equal(result.input.averageCost, null);
    assert.equal(result.input.portfolioGroupId, null);
    assert.equal(result.input.newPortfolioGroupName, null);
    assert.equal(calculateLocalReturnPct({ averageCost: null, currentPrice: 200 }), null);
    for (const averageCost of ["0", "-1", "NaN", "100.12345"]) {
      const invalid = parseHoldingOnboardingInput(form({
        accountId: ACCOUNT_ID, market: "us", assetType: "stock", ticker: "AAPL", quantity: "2", averageCost,
      }));
      assert.equal(invalid.ok, false);
      assert.equal(invalid.field, "averageCost");
    }
  });

  it("rejects two group authorities and invalid cost evidence", () => {
    const conflictingGroup = parseHoldingOnboardingInput(
      form({
        accountId: ACCOUNT_ID,
        portfolioGroupId: GROUP_ID,
        newPortfolioGroupName: "새 그룹",
        market: "korea",
        assetType: "etf",
        ticker: "069500",
        quantity: "1",
        averageCost: "100",
      }),
    );
    const zeroCost = parseHoldingOnboardingInput(
      form({
        accountId: ACCOUNT_ID,
        portfolioGroupId: GROUP_ID,
        market: "korea",
        assetType: "etf",
        ticker: "069500",
        quantity: "1",
        averageCost: "0",
      }),
    );

    assert.deepEqual(conflictingGroup, {
      ok: false,
      field: "portfolioGroup",
      message: "기존 분석 범위 선택과 새 범위 이름 중 하나만 입력해 주세요.",
    });
    assert.equal(zeroCost.ok, false);
    assert.equal(zeroCost.field, "averageCost");
  });

  it("limits decimals and treats reported return as optional reference", () => {
    const excessiveQuantityScale = parseHoldingOnboardingInput(
      form({
        accountId: ACCOUNT_ID,
        portfolioGroupId: GROUP_ID,
        market: "us",
        assetType: "stock",
        ticker: "AAPL",
        quantity: "1.1234567",
        averageCost: "100",
      }),
    );
    const impossibleReturn = parseHoldingOnboardingInput(
      form({
        accountId: ACCOUNT_ID,
        portfolioGroupId: GROUP_ID,
        market: "us",
        assetType: "stock",
        ticker: "AAPL",
        quantity: "1",
        averageCost: "100",
        reportedReturnPct: "-100",
      }),
    );

    assert.equal(excessiveQuantityScale.ok, false);
    assert.equal(excessiveQuantityScale.field, "quantity");
    assert.equal(impossibleReturn.ok, false);
    assert.equal(impossibleReturn.field, "reportedReturnPct");
    assert.equal(calculateLocalReturnPct({ averageCost: 100, currentPrice: 125 }), 25);
  });

  it("keeps ownership server-derived and commits the onboarding set atomically", () => {
    assert.match(writerSource, /resolveCurrentTenantContext\(\)/);
    assert.match(writerSource, /prepareTenantWriteContext\(/);
    assert.match(writerSource, /runPortfolioMutation\(ownerUserId, ATOMIC_ONBOARDING_QUERY/);
    assert.match(writerSource, /insert into holding_onboarding_evidence/);
    assert.match(
      writerSource,
      /resolveSnapshotCycle\(recordedAt\)\.snapshotDate/,
    );
    assert.doesNotMatch(formSource, /name=["'](?:canonicalOwnerUserId|ownerUserId)["']/);
    assert.doesNotMatch(writerSource, /\bfetch\s*\(/);
  });

  it("keeps missing cost unknown and broker return reference-only", () => {
    assert.equal(HOLDING_ONBOARDING_POLICY.missingAverageCost, "unknown_never_zero_or_current_price");
    assert.equal(HOLDING_ONBOARDING_POLICY.reportedReturnRole, "reference_only");
  });
});

function form(values) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) {
    data.set(key, value);
  }
  return data;
}
