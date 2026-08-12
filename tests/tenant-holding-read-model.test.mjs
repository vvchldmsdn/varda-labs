import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectTenantHoldingRows } from "../src/lib/tenant-holding-read-model.ts";

const ALL_SCOPE = Object.freeze({ kind: "all", key: "all", label: "전체" });
const BROKERAGE_SCOPE = Object.freeze({
  kind: "account",
  key: "account:11111111-1111-4111-8111-111111111111",
  label: "Brokerage",
  accountId: "account-brokerage",
  accountCode: "brokerage",
});
const ISA_SCOPE = Object.freeze({
  kind: "account",
  key: "account:22222222-2222-4222-8222-222222222222",
  label: "ISA",
  accountId: "account-isa",
  accountCode: "isa",
});

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
    const result = projectTenantHoldingRows([ISA, BROKERAGE], ALL_SCOPE);

    assert.deepEqual(result, {
      state: "ready",
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
      BROKERAGE_SCOPE,
    );

    assert.equal(result.state, "ready");
    assert.equal(result.holdings[0]?.ticker, null);
  });

  it("fails closed for account relation or selected-scope drift", () => {
    assert.deepEqual(
      projectTenantHoldingRows(
        [{ ...BROKERAGE, assetAccountId: "foreign-account" }],
        ALL_SCOPE,
      ),
      { state: "integrity_error", reason: "invalid_account_relation" },
    );
    assert.deepEqual(projectTenantHoldingRows([BROKERAGE], ISA_SCOPE), {
      state: "integrity_error",
      reason: "account_scope_mismatch",
    });
  });

  it("fails closed for duplicate authority rows", () => {
    assert.deepEqual(
      projectTenantHoldingRows([BROKERAGE, BROKERAGE], ALL_SCOPE),
      { state: "integrity_error", reason: "duplicate_asset_row" },
    );
  });

  it("keeps valid holdings when one display-evidence row is malformed", () => {
    const result = projectTenantHoldingRows(
      [{ ...BROKERAGE, currentPrice: "NaN" }, ISA],
      ALL_SCOPE,
    );

    assert.equal(result.state, "partial");
    assert.equal(result.holdings.length, 1);
    assert.equal(result.holdings[0]?.accountCode, "isa");
    assert.equal(result.excludedHoldingCount, 1);
  });

  it("accepts owner-scoped account codes beyond the imported fixed labels", () => {
    const result = projectTenantHoldingRows(
      [
        {
          ...BROKERAGE,
          accountCode: "future-broker-2",
          legacyAccountCode: "future-broker-2",
          accountName: "두 번째 증권 계좌",
        },
      ],
      ALL_SCOPE,
    );

    assert.equal(result.state, "ready");
    assert.equal(result.holdings[0]?.accountCode, "future-broker-2");
  });
});
