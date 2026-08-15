import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  INVESTMENT_LAB_ANALYSIS_SCOPE_POLICY,
  buildInvestmentLabAnalysisScopeEvidence,
} from "../src/lib/investment-lab-analysis-scope.ts";

const BROKERAGE_ID = "11111111-1111-4111-8111-111111111111";
const ISA_ID = "22222222-2222-4222-8222-222222222222";
const CUSTOM_ID = "33333333-3333-4333-8333-333333333333";
const IRP_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ACCOUNTS = Object.freeze([
  Object.freeze({ id: BROKERAGE_ID, code: "brokerage", isActive: true }),
  Object.freeze({ id: ISA_ID, code: "isa", isActive: true }),
  Object.freeze({ id: CUSTOM_ID, code: "custom", isActive: true }),
  Object.freeze({ id: IRP_ID, code: "irp", isActive: true }),
]);

const GROUP_SCOPE = Object.freeze({
  kind: "portfolio_group",
  key: `portfolio:${GROUP_ID}`,
  label: "장기 투자",
  portfolioGroupId: GROUP_ID,
});

describe("investment lab dynamic analysis scope", () => {
  it("resolves effective-dated account and direct-asset membership per row date", () => {
    const positions = [
      position({
        account: "brokerage",
        accountId: BROKERAGE_ID,
        assetId: "asset-a",
        marketValueKrw: 100,
        snapshotDate: "2026-01-02",
        ticker: "069500",
      }),
      position({
        account: "brokerage",
        accountId: BROKERAGE_ID,
        assetId: "asset-a",
        marketValueKrw: 110,
        snapshotDate: "2026-01-03",
        ticker: "069500",
      }),
      position({
        account: "irp",
        accountId: IRP_ID,
        assetId: "asset-b",
        marketValueKrw: 190,
        snapshotDate: "2026-01-02",
        ticker: "360200",
      }),
      position({
        account: "isa",
        accountId: ISA_ID,
        assetId: "asset-b",
        marketValueKrw: 200,
        snapshotDate: "2026-01-03",
        ticker: "360200",
      }),
      position({
        account: "custom",
        accountId: CUSTOM_ID,
        assetId: "direct-asset",
        marketValueKrw: 25,
        snapshotDate: "2026-01-02",
        ticker: "QQQ",
      }),
    ];
    const evidence = buildInvestmentLabAnalysisScopeEvidence({
      accounts: ACCOUNTS,
      accountMemberships: [
        { targetId: BROKERAGE_ID, validFrom: "2026-01-01", validTo: "2026-01-03" },
        { targetId: ISA_ID, validFrom: "2026-01-03", validTo: null },
      ],
      assetMemberships: [
        { targetId: "direct-asset", validFrom: "2026-01-02", validTo: null },
      ],
      events: [],
      positions,
      provenanceRows: provenanceFor(positions),
      scope: GROUP_SCOPE,
    });

    assert.equal(
      evidence.policy.membershipWindow,
      "valid_from_inclusive_valid_to_exclusive",
    );
    assert.equal(evidence.policy, INVESTMENT_LAB_ANALYSIS_SCOPE_POLICY);
    assert.equal(evidence.engineAccount, "brokerage");
    assert.equal(evidence.supportsLegacyTargetPolicy, false);
    assert.deepEqual(
      evidence.anchorPositionRows.map((row) => [
        row.snapshotDate,
        row.ticker,
        row.account,
        row.identityAccount,
      ]),
      [
        ["2026-01-02", "069500", "brokerage", "brokerage"],
        ["2026-01-03", "360200", "brokerage", "isa"],
        ["2026-01-02", "QQQ", "brokerage", "custom"],
      ],
    );
    assert.deepEqual(
      evidence.snapshotRows.map((row) => [
        row.snapshotDate,
        row.account,
        row.totalMarketValue,
      ]),
      [
        ["2026-01-02", "brokerage", 125],
        ["2026-01-03", "brokerage", 200],
      ],
    );
  });

  it("applies the same historical scope to events without double-counting union membership", () => {
    const events = [
      event({
        account: "brokerage",
        accountId: BROKERAGE_ID,
        assetId: "shared-asset",
        eventDate: "2026-01-02",
      }),
      event({
        account: "isa",
        accountId: ISA_ID,
        assetId: "asset-b",
        eventDate: "2026-01-02",
      }),
    ];
    const evidence = buildInvestmentLabAnalysisScopeEvidence({
      accounts: ACCOUNTS,
      accountMemberships: [
        { targetId: BROKERAGE_ID, validFrom: "2026-01-01", validTo: null },
      ],
      assetMemberships: [
        { targetId: "shared-asset", validFrom: "2026-01-01", validTo: null },
      ],
      events,
      positions: [],
      provenanceRows: [],
      scope: GROUP_SCOPE,
    });

    assert.equal(evidence.eventRows.length, 1);
    assert.equal(evidence.eventRows[0].account, "brokerage");
    assert.equal(evidence.eventRows[0].sequence, 1);
  });

  it("keeps gold evidence but removes Fount positions and matching events", () => {
    const positions = [
      position({
        account: "brokerage",
        accountId: BROKERAGE_ID,
        assetId: "gold",
        assetName: "금현물",
        assetType: "commodity",
        marketValueKrw: 50,
        snapshotDate: "2026-01-02",
        ticker: null,
      }),
      position({
        account: "irp",
        accountId: IRP_ID,
        assetId: "fount",
        assetName: "Fount 일임서비스",
        marketValueKrw: 999,
        snapshotDate: "2026-01-02",
        ticker: null,
      }),
    ];
    const evidence = buildInvestmentLabAnalysisScopeEvidence({
      accounts: ACCOUNTS,
      accountMemberships: [
        { targetId: BROKERAGE_ID, validFrom: "2026-01-01", validTo: null },
        { targetId: IRP_ID, validFrom: "2026-01-01", validTo: null },
      ],
      events: [
        event({
          account: "irp",
          accountId: IRP_ID,
          assetId: "fount",
          assetName: null,
          eventDate: "2026-01-02",
        }),
      ],
      positions,
      provenanceRows: provenanceFor(positions),
      scope: GROUP_SCOPE,
    });

    assert.deepEqual(
      evidence.anchorPositionRows.map((row) => row.assetName),
      ["금현물"],
    );
    assert.equal(evidence.snapshotRows[0].totalMarketValue, 50);
    assert.equal(evidence.eventRows.length, 0);
    assert.deepEqual(evidence.fountAdjustment, {
      status: "applied",
      excludedPositionRowCount: 1,
      excludedEventRowCount: 1,
      adjustedDateCount: 1,
    });
  });

  it("does not fall back when a portfolio group has no effective members", () => {
    const evidence = buildInvestmentLabAnalysisScopeEvidence({
      accounts: ACCOUNTS,
      events: [event({ accountId: BROKERAGE_ID })],
      positions: [position({ accountId: BROKERAGE_ID })],
      provenanceRows: [],
      scope: GROUP_SCOPE,
    });

    assert.deepEqual(evidence.snapshotRows, []);
    assert.deepEqual(evidence.eventRows, []);
    assert.deepEqual(evidence.anchorPositionRows, []);
    assert.deepEqual(evidence.includedAccountCodes, []);
  });

  it("retains incomplete dates without imputing a missing stored valuation", () => {
    const positions = [position({ marketValueKrw: null })];
    const evidence = buildInvestmentLabAnalysisScopeEvidence({
      accounts: ACCOUNTS,
      events: [],
      positions,
      provenanceRows: provenanceFor(positions),
      scope: {
        kind: "account",
        key: `account:${BROKERAGE_ID}`,
        label: "증권",
        accountId: BROKERAGE_ID,
        accountCode: "brokerage",
      },
    });

    assert.equal(
      evidence.policy.missingValuationBehavior,
      "retain_date_as_incomplete_without_imputation",
    );
    assert.equal(evidence.engineAccount, "brokerage");
    assert.equal(evidence.supportsLegacyTargetPolicy, true);
    assert.equal(evidence.snapshotRows.length, 1);
    assert.equal(evidence.snapshotRows[0].totalMarketValue, null);
  });
});

function position(overrides = {}) {
  return {
    snapshotDate: "2026-01-02",
    accountId: BROKERAGE_ID,
    assetId: "asset-a",
    legacyAssetId: null,
    account: "brokerage",
    source: "daily_snapshot_writer",
    ticker: "069500",
    assetName: "KODEX 200",
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    quantity: 1,
    marketValueKrw: 100,
    priceSource: "kis",
    priceBasis: "raw_close",
    currentPrice: 100,
    priceDate: "2026-01-02",
    referenceDate: "2026-01-02",
    capturedAt: "2026-01-03T00:00:00.000Z",
    ...overrides,
  };
}

function event(overrides = {}) {
  return {
    accountId: BROKERAGE_ID,
    assetId: "asset-a",
    legacyAssetId: null,
    account: "brokerage",
    assetName: "KODEX 200",
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    eventDate: "2026-01-02",
    eventType: "buy",
    sequence: 10,
    amountKrw: 100,
    quantityDelta: 1,
    price: 100,
    fxRate: 1,
    assetCurrency: "KRW",
    isCorrection: false,
    ...overrides,
  };
}

function provenanceFor(positions) {
  return positions.map((row) => ({
    snapshotDate: row.snapshotDate,
    accountId: row.accountId,
    account: row.account,
    source: row.source,
    ruleVersion: "daily_snapshot_v1",
  }));
}
