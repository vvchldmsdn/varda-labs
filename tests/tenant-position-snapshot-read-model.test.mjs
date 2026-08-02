import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseTenantPositionSnapshotDateQuery,
  projectTenantPositionSnapshotRows,
} from "../src/lib/tenant-position-snapshot-read-model.ts";

const BROKERAGE_ACCOUNT = Object.freeze({
  accountId: "account-brokerage",
  accountCode: "brokerage",
  accountName: "Brokerage",
  accountSortOrder: 10,
});

const ISA_ACCOUNT = Object.freeze({
  accountId: "account-isa",
  accountCode: "isa",
  accountName: "ISA",
  accountSortOrder: 20,
});

const BROKERAGE_POSITION = Object.freeze({
  snapshotDate: "2026-07-02",
  source: "base44_import",
  isSample: false,
  assetId: "asset-brokerage-1",
  legacyAssetId: "69b7e7fa1e6e1110bd318230",
  snapshotAccountId: "account-brokerage",
  ownedAccountId: "account-brokerage",
  accountCode: "brokerage",
  accountName: "Brokerage",
  accountSortOrder: 10,
  legacyAccountCode: "brokerage",
  assetName: "KODEX 200",
  ticker: "069500",
  assetType: "etf",
  market: "korea",
  currency: "KRW",
  quantity: "47.00000000",
  currentPrice: "117700.000000",
  closePrice: null,
  marketValueKrw: "5531900.000000",
  currentWeight: "20.620000",
  targetWeight: "22.000000",
  belowMa: false,
  priceSource: "kis",
  priceBasis: "close",
});

const ISA_HISTORICAL_POSITION = Object.freeze({
  ...BROKERAGE_POSITION,
  assetId: null,
  legacyAssetId: "69b7e7fa1e6e1110bd318235",
  snapshotAccountId: "account-isa",
  ownedAccountId: "account-isa",
  accountCode: "isa",
  accountName: "ISA",
  accountSortOrder: 20,
  legacyAccountCode: "isa",
  assetName: "ACE KRX Gold Spot",
  ticker: "411060",
  assetType: "commodity",
  quantity: "8.00000000",
  currentPrice: null,
  closePrice: "192000.000000",
  marketValueKrw: "1536000.000000",
  currentWeight: "5.720000",
  targetWeight: null,
  priceSource: "stored_close",
});

describe("tenant position snapshot date query", () => {
  it("accepts one real date or an omitted date and rejects ambiguous values", () => {
    assert.equal(parseTenantPositionSnapshotDateQuery(undefined), undefined);
    assert.equal(parseTenantPositionSnapshotDateQuery(""), undefined);
    assert.equal(
      parseTenantPositionSnapshotDateQuery("2026-07-02"),
      "2026-07-02",
    );
    assert.equal(parseTenantPositionSnapshotDateQuery("2026-02-30"), null);
    assert.equal(parseTenantPositionSnapshotDateQuery(["2026-07-02"]), null);
  });
});

describe("tenant position snapshot read model", () => {
  it("keeps mapped and historical-only assets without exposing durable identities", () => {
    const result = projectTenantPositionSnapshotRows({
      accountRows: [ISA_ACCOUNT, BROKERAGE_ACCOUNT],
      rows: [ISA_HISTORICAL_POSITION, BROKERAGE_POSITION],
      scope: "all",
      snapshotDate: "2026-07-02",
    });

    assert.equal(result.state, "ready");
    assert.deepEqual(result.expectedAccounts, ["brokerage", "isa"]);
    assert.deepEqual(result.coveredAccounts, ["brokerage", "isa"]);
    assert.deepEqual(result.missingAccounts, []);
    assert.equal(result.linkedPositionCount, 1);
    assert.equal(result.historicalOnlyPositionCount, 1);
    assert.equal(result.positions.length, 2);
    assert.equal(result.positions[1]?.assetLinkStatus, "historical_only");
    assert.equal(result.positions[1]?.storedPriceKind, "close_price");
    assert.doesNotMatch(
      JSON.stringify(result),
      /assetId|legacyAssetId|snapshotAccountId|ownedAccountId|ownerUserId|providerSubject/,
    );
  });

  it("shows valid evidence as partial when an owned account has no rows", () => {
    const result = projectTenantPositionSnapshotRows({
      accountRows: [BROKERAGE_ACCOUNT, ISA_ACCOUNT],
      rows: [BROKERAGE_POSITION],
      scope: "all",
      snapshotDate: "2026-07-02",
    });

    assert.equal(result.state, "partial");
    assert.deepEqual(result.coveredAccounts, ["brokerage"]);
    assert.deepEqual(result.missingAccounts, ["isa"]);
    assert.equal(result.positions.length, 1);
  });

  it("excludes malformed display evidence without hiding valid positions", () => {
    const result = projectTenantPositionSnapshotRows({
      accountRows: [BROKERAGE_ACCOUNT, ISA_ACCOUNT],
      rows: [
        BROKERAGE_POSITION,
        { ...ISA_HISTORICAL_POSITION, marketValueKrw: "NaN" },
      ],
      scope: "all",
      snapshotDate: "2026-07-02",
    });

    assert.equal(result.state, "partial");
    assert.equal(result.positions.length, 1);
    assert.equal(result.excludedPositionCount, 1);
    assert.deepEqual(result.missingAccounts, []);
  });

  it("fails closed when a snapshot is not linked to the owned account", () => {
    assert.deepEqual(
      projectTenantPositionSnapshotRows({
        accountRows: [BROKERAGE_ACCOUNT],
        rows: [
          {
            ...BROKERAGE_POSITION,
            snapshotAccountId: "foreign-account",
          },
        ],
        scope: "brokerage",
        snapshotDate: "2026-07-02",
      }),
      { state: "integrity_error", reason: "invalid_account_relation" },
    );
  });

  it("fails closed for mixed dates, sources, samples, and duplicate positions", () => {
    const input = {
      accountRows: [BROKERAGE_ACCOUNT],
      scope: "brokerage",
      snapshotDate: "2026-07-02",
    };

    assert.deepEqual(
      projectTenantPositionSnapshotRows({
        ...input,
        rows: [{ ...BROKERAGE_POSITION, snapshotDate: "2026-07-01" }],
      }),
      { state: "integrity_error", reason: "snapshot_date_mismatch" },
    );
    assert.deepEqual(
      projectTenantPositionSnapshotRows({
        ...input,
        rows: [
          BROKERAGE_POSITION,
          {
            ...BROKERAGE_POSITION,
            assetId: "asset-brokerage-2",
            source: "other_source",
          },
        ],
      }),
      { state: "integrity_error", reason: "mixed_snapshot_sources" },
    );
    assert.deepEqual(
      projectTenantPositionSnapshotRows({
        ...input,
        rows: [{ ...BROKERAGE_POSITION, isSample: true }],
      }),
      { state: "integrity_error", reason: "sample_row_admitted" },
    );
    assert.deepEqual(
      projectTenantPositionSnapshotRows({
        ...input,
        rows: [BROKERAGE_POSITION, BROKERAGE_POSITION],
      }),
      { state: "integrity_error", reason: "duplicate_position_row" },
    );
  });

  it("returns explicit no-data evidence for an empty owned date", () => {
    assert.deepEqual(
      projectTenantPositionSnapshotRows({
        accountRows: [BROKERAGE_ACCOUNT],
        rows: [],
        scope: "brokerage",
        snapshotDate: "2026-07-03",
      }),
      {
        state: "no_data",
        scope: "brokerage",
        snapshotDate: "2026-07-03",
        expectedAccounts: ["brokerage"],
      },
    );
  });
});
