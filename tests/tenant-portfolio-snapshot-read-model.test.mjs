import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { projectTenantPortfolioSnapshotRows } from "../src/lib/tenant-portfolio-snapshot-read-model.ts";
import { parseTenantSnapshotDateQuery } from "../src/lib/tenant-snapshot-date-query.ts";

const BROKERAGE_ACCOUNT = Object.freeze({
  accountId: "account-brokerage",
  accountCode: "brokerage",
  accountName: "Brokerage",
  accountSortOrder: 10,
});

const ALL_SCOPE = Object.freeze({
  kind: "all",
  key: "all",
  label: "All",
});
const BROKERAGE_SCOPE = Object.freeze({
  kind: "account",
  key: "account:11111111-1111-4111-8111-111111111111",
  label: "Brokerage",
  accountId: BROKERAGE_ACCOUNT.accountId,
  accountCode: BROKERAGE_ACCOUNT.accountCode,
});

const ISA_ACCOUNT = Object.freeze({
  accountId: "account-isa",
  accountCode: "isa",
  accountName: "ISA",
  accountSortOrder: 20,
});

const BROKERAGE_SNAPSHOT = Object.freeze({
  snapshotDate: "2026-07-09",
  source: "varda_daily_snapshot_v1",
  ruleVersion: "daily_snapshot_v1",
  isSample: false,
  snapshotAccountId: "account-brokerage",
  ownedAccountId: "account-brokerage",
  accountCode: "brokerage",
  accountName: "Brokerage",
  accountSortOrder: 10,
  legacyAccountCode: "brokerage",
  cashValue: "0.000000",
  investedAmount: "800.000000",
  totalCost: "800.000000",
  totalMarketValue: "1000.000000",
  totalPnl: "200.000000",
  totalReturnPct: "25.000000",
  fxRate: "1516.900000",
  usdKrw: "1516.900000",
  krWeight: "60.000000",
  usWeight: "40.000000",
  usdExposurePct: "40.000000",
  numAssets: 3,
  numGroups: 2,
  topHoldingName: "KODEX 200",
  topHoldingWeight: "50.000000",
  capturedAt: new Date("2026-07-10T00:00:00.000Z"),
});

const ISA_SNAPSHOT = Object.freeze({
  ...BROKERAGE_SNAPSHOT,
  snapshotAccountId: "account-isa",
  ownedAccountId: "account-isa",
  accountCode: "isa",
  accountName: "ISA",
  accountSortOrder: 20,
  legacyAccountCode: "isa",
  investedAmount: "500.000000",
  totalCost: "500.000000",
  totalMarketValue: "550.000000",
  totalPnl: "50.000000",
  totalReturnPct: "10.000000",
  numAssets: 2,
  numGroups: 1,
  topHoldingName: "ACE S&P 500",
  topHoldingWeight: "55.000000",
});

describe("tenant snapshot date query", () => {
  it("accepts one real date or an omitted date and rejects ambiguous values", () => {
    assert.equal(parseTenantSnapshotDateQuery(undefined), undefined);
    assert.equal(parseTenantSnapshotDateQuery(""), undefined);
    assert.equal(parseTenantSnapshotDateQuery("2026-07-09"), "2026-07-09");
    assert.equal(parseTenantSnapshotDateQuery("2026-02-30"), null);
    assert.equal(parseTenantSnapshotDateQuery(["2026-07-09"]), null);
  });
});

describe("tenant portfolio snapshot read model", () => {
  it("derives a complete total from named owned-account rows only", () => {
    const result = projectTenantPortfolioSnapshotRows({
      accountRows: [ISA_ACCOUNT, BROKERAGE_ACCOUNT],
      rows: [ISA_SNAPSHOT, BROKERAGE_SNAPSHOT],
      scope: ALL_SCOPE,
      snapshotDate: "2026-07-09",
    });

    assert.equal(result.state, "ready");
    assert.deepEqual(result.expectedAccounts, ["brokerage", "isa"]);
    assert.deepEqual(result.coveredAccounts, ["brokerage", "isa"]);
    assert.equal(result.aggregate?.evidenceKind, "complete_total");
    assert.equal(result.aggregate?.totalMarketValue, "1550.000000");
    assert.equal(result.aggregate?.investedAmount, "1300.000000");
    assert.equal(result.aggregate?.totalPnl, "250.000000");
    assert.equal(result.aggregate?.totalReturnPct, "19.230769");
    assert.equal(result.aggregate?.numAssets, 5);
    assert.doesNotMatch(
      JSON.stringify(result),
      /accountId|snapshotAccountId|ownedAccountId|ownerUserId|legacyBase44Id|providerSubject/,
    );
  });

  it("never admits the stored all row as ownership evidence", () => {
    assert.deepEqual(
      projectTenantPortfolioSnapshotRows({
        accountRows: [BROKERAGE_ACCOUNT],
        rows: [
          {
            ...BROKERAGE_SNAPSHOT,
            snapshotAccountId: null,
            ownedAccountId: "account-all",
            accountCode: "all",
            legacyAccountCode: "all",
          },
        ],
        scope: ALL_SCOPE,
        snapshotDate: "2026-07-09",
      }),
      { state: "integrity_error", reason: "invalid_account_relation" },
    );
  });

  it("keeps available rows as a subtotal when an owned account is missing", () => {
    const result = projectTenantPortfolioSnapshotRows({
      accountRows: [BROKERAGE_ACCOUNT, ISA_ACCOUNT],
      rows: [BROKERAGE_SNAPSHOT],
      scope: ALL_SCOPE,
      snapshotDate: "2026-07-09",
    });

    assert.equal(result.state, "partial");
    assert.deepEqual(result.missingAccounts, ["isa"]);
    assert.equal(result.aggregate?.evidenceKind, "available_subtotal");
    assert.equal(result.aggregate?.totalMarketValue, "1000.000000");
  });

  it("excludes malformed display evidence without hiding valid account rows", () => {
    const result = projectTenantPortfolioSnapshotRows({
      accountRows: [BROKERAGE_ACCOUNT, ISA_ACCOUNT],
      rows: [BROKERAGE_SNAPSHOT, { ...ISA_SNAPSHOT, totalPnl: "NaN" }],
      scope: ALL_SCOPE,
      snapshotDate: "2026-07-09",
    });

    assert.equal(result.state, "partial");
    assert.equal(result.snapshots.length, 1);
    assert.equal(result.excludedSnapshotCount, 1);
    assert.deepEqual(result.missingAccounts, ["isa"]);
    assert.equal(result.aggregate?.totalMarketValue, "1000.000000");
  });

  it("marks mixed rule versions and incomplete core evidence as partial", () => {
    const result = projectTenantPortfolioSnapshotRows({
      accountRows: [BROKERAGE_ACCOUNT, ISA_ACCOUNT],
      rows: [
        BROKERAGE_SNAPSHOT,
        {
          ...ISA_SNAPSHOT,
          ruleVersion: "daily_snapshot_v2",
          totalCost: null,
        },
      ],
      scope: ALL_SCOPE,
      snapshotDate: "2026-07-09",
    });

    assert.equal(result.state, "partial");
    assert.equal(result.hasMixedRuleVersions, true);
    assert.equal(result.incompleteCoreSnapshotCount, 1);
    assert.equal(result.aggregate?.totalCost, null);
  });

  it("fails closed for invalid relations, mixed sources, samples, and duplicates", () => {
    const input = {
      accountRows: [BROKERAGE_ACCOUNT],
      scope: BROKERAGE_SCOPE,
      snapshotDate: "2026-07-09",
    };

    assert.deepEqual(
      projectTenantPortfolioSnapshotRows({
        ...input,
        rows: [
          { ...BROKERAGE_SNAPSHOT, snapshotAccountId: "foreign-account" },
        ],
      }),
      { state: "integrity_error", reason: "invalid_account_relation" },
    );
    assert.deepEqual(
      projectTenantPortfolioSnapshotRows({
        ...input,
        rows: [
          BROKERAGE_SNAPSHOT,
          { ...BROKERAGE_SNAPSHOT, source: "other_source" },
        ],
      }),
      { state: "integrity_error", reason: "mixed_snapshot_sources" },
    );
    assert.deepEqual(
      projectTenantPortfolioSnapshotRows({
        ...input,
        rows: [{ ...BROKERAGE_SNAPSHOT, isSample: true }],
      }),
      { state: "integrity_error", reason: "sample_row_admitted" },
    );
    assert.deepEqual(
      projectTenantPortfolioSnapshotRows({
        ...input,
        rows: [BROKERAGE_SNAPSHOT, BROKERAGE_SNAPSHOT],
      }),
      { state: "integrity_error", reason: "duplicate_account_snapshot" },
    );
  });

  it("returns explicit no-data evidence for an empty owned date", () => {
    assert.deepEqual(
      projectTenantPortfolioSnapshotRows({
        accountRows: [BROKERAGE_ACCOUNT],
        rows: [],
        scope: BROKERAGE_SCOPE,
        snapshotDate: "2026-07-10",
      }),
      {
        state: "no_data",
        scope: BROKERAGE_SCOPE,
        snapshotDate: "2026-07-10",
        expectedAccounts: ["brokerage"],
      },
    );
  });
});
