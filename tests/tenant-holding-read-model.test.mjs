import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectTenantHoldingRows } from "../src/lib/tenant-holding-read-model.ts";

const BROKERAGE = Object.freeze({
  assetId: "asset-brokerage-1",
  assetAccountId: "account-brokerage",
  ownedAccountId: "account-brokerage",
  accountCode: "brokerage",
  accountName: "Brokerage",
  accountSortOrder: 10,
  legacyAccountCode: "brokerage",
  name: "KODEX 200",
  ticker: "069500",
  assetType: "etf",
  market: "korea",
  currency: "KRW",
  quantity: "47.000000",
  currentPrice: "117700.0000",
  priceSource: "kis_domestic_inquire_price",
  priceAsOf: new Date("2026-07-09T04:20:00.000Z"),
  priceStatus: "ok",
});

const ISA = Object.freeze({
  ...BROKERAGE,
  assetId: "asset-isa-1",
  assetAccountId: "account-isa",
  ownedAccountId: "account-isa",
  accountCode: "isa",
  accountName: "ISA",
  accountSortOrder: 20,
  legacyAccountCode: "isa",
  name: "ACE US S&P 500",
  ticker: "360200",
  quantity: "12.000000",
  currentPrice: "25000.0000",
});

describe("tenant holding read model", () => {
  it("projects sorted minimal DTOs without database or owner identities", () => {
    const result = projectTenantHoldingRows([ISA, BROKERAGE], "all");

    assert.deepEqual(result, {
      state: "ready",
      scope: "all",
      holdings: [
        {
          accountCode: "brokerage",
          accountName: "Brokerage",
          name: "KODEX 200",
          ticker: "069500",
          assetType: "etf",
          market: "korea",
          currency: "KRW",
          quantity: "47.000000",
          currentPrice: "117700.0000",
          priceSource: "kis_domestic_inquire_price",
          priceAsOf: "2026-07-09T04:20:00.000Z",
          priceStatus: "ok",
        },
        {
          accountCode: "isa",
          accountName: "ISA",
          name: "ACE US S&P 500",
          ticker: "360200",
          assetType: "etf",
          market: "korea",
          currency: "KRW",
          quantity: "12.000000",
          currentPrice: "25000.0000",
          priceSource: "kis_domestic_inquire_price",
          priceAsOf: "2026-07-09T04:20:00.000Z",
          priceStatus: "ok",
        },
      ],
      excludedHoldingCount: 0,
    });
    assert.doesNotMatch(
      JSON.stringify(result),
      /ownerUserId|canonicalOwner|providerSubject|assetId|accountId|legacy/i,
    );
  });

  it("accepts a canonical ticker-less holding", () => {
    const result = projectTenantHoldingRows(
      [
        {
          ...BROKERAGE,
          assetId: "asset-gold",
          name: "Gold spot",
          ticker: null,
          assetType: "commodity",
          priceSource: null,
          priceAsOf: null,
          priceStatus: null,
        },
      ],
      "brokerage",
    );

    assert.equal(result.state, "ready");
    assert.equal(result.holdings[0]?.ticker, null);
  });

  it("fails closed for account relation or selected-scope drift", () => {
    assert.deepEqual(
      projectTenantHoldingRows(
        [{ ...BROKERAGE, assetAccountId: "foreign-account" }],
        "all",
      ),
      { state: "integrity_error", reason: "invalid_account_relation" },
    );
    assert.deepEqual(projectTenantHoldingRows([BROKERAGE], "isa"), {
      state: "integrity_error",
      reason: "account_scope_mismatch",
    });
  });

  it("fails closed for duplicate authority rows", () => {
    assert.deepEqual(
      projectTenantHoldingRows([BROKERAGE, BROKERAGE], "all"),
      { state: "integrity_error", reason: "duplicate_asset_row" },
    );
  });

  it("keeps valid holdings when one display-evidence row is malformed", () => {
    const result = projectTenantHoldingRows(
      [{ ...BROKERAGE, currentPrice: "NaN" }, ISA],
      "all",
    );

    assert.equal(result.state, "partial");
    assert.equal(result.holdings.length, 1);
    assert.equal(result.holdings[0]?.accountCode, "isa");
    assert.equal(result.excludedHoldingCount, 1);
  });
});
