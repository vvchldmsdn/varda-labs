import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  projectTenantEventLedgerRows,
  TENANT_EVENT_LEDGER_POLICY,
} from "../src/lib/tenant-event-ledger-read-model.ts";

const BROKERAGE_EVENT = Object.freeze({
  internalId: "event-brokerage",
  legacyBase44Id: "legacy-brokerage",
  eventAccountId: "account-brokerage",
  ownedAccountId: "account-brokerage",
  accountCode: "brokerage",
  accountName: "Brokerage",
  accountSortOrder: 10,
  isSample: false,
  eventDate: "2026-07-02",
  eventType: "buy",
  source: "manual",
  recordedAt: "2026-07-02T03:00:00.000Z",
  ruleVersion: "event_v1",
  account: "brokerage",
  assetId: "asset-brokerage",
  legacyAssetId: "legacy-asset-brokerage",
  ticker: "069500",
  assetName: "KODEX 200",
  groupName: null,
  correctsEventId: null,
  legacyCorrectsEventId: null,
  amountKrw: "100000",
  quantityDelta: "1",
  price: "100000",
  fxRate: null,
});

const ISA_EVENT = Object.freeze({
  ...BROKERAGE_EVENT,
  internalId: "event-isa",
  legacyBase44Id: "legacy-isa",
  eventAccountId: "account-isa",
  ownedAccountId: "account-isa",
  accountCode: "isa",
  accountName: "ISA",
  accountSortOrder: 20,
  eventDate: "2026-07-03",
  eventType: "asset_removed",
  account: "isa",
  assetId: null,
  legacyAssetId: "legacy-asset-isa",
  ticker: "133690",
  assetName: "TIGER NASDAQ 100",
  amountKrw: null,
  quantityDelta: null,
  price: null,
});

describe("tenant event ledger read model", () => {
  it("derives all scope only from events linked to owned named accounts", () => {
    const result = projectTenantEventLedgerRows(
      [BROKERAGE_EVENT, ISA_EVENT],
      "all",
    );

    assert.equal(result.state, "ready");
    assert.equal(result.authorityStatus, "linked_rows_only");
    assert.equal(result.eventCount, 2);
    assert.equal(result.tradeCount, 1);
    assert.equal(result.lifecycleCount, 1);
    assert.equal(result.legacyOnlyCount, 1);
    assert.deepEqual(
      result.events.map((event) => event.accountCode),
      ["isa", "brokerage"],
    );
    assert.equal(result.events[0].accountName, "ISA");
    assert.doesNotMatch(
      JSON.stringify(result),
      /event-brokerage|legacy-brokerage|account-brokerage|ownerUserId|providerSubject|legacyBase44Id/,
    );
  });

  it("keeps incomplete events visible and marks the bounded result partial", () => {
    const rows = Array.from({ length: 101 }, (_, index) => ({
      ...BROKERAGE_EVENT,
      internalId: `event-${index}`,
      legacyBase44Id: `legacy-${index}`,
      amountKrw: index === 0 ? null : "100000",
      quantityDelta: index === 0 ? null : "1",
      price: index === 0 ? null : "100000",
    }));
    const result = projectTenantEventLedgerRows(rows, "brokerage");

    assert.equal(TENANT_EVENT_LEDGER_POLICY.rowLimit, 100);
    assert.equal(result.state, "partial");
    assert.equal(result.eventCount, 100);
    assert.equal(result.rowLimitExceeded, true);
    assert.ok(result.partialCount >= 1);
    assert.ok(
      result.events.some((event) =>
        event.missingFields.includes("amount_krw"),
      ),
    );
  });

  it("fails closed for invalid ownership, samples, duplicates, and scope drift", () => {
    assert.deepEqual(
      projectTenantEventLedgerRows(
        [{ ...BROKERAGE_EVENT, eventAccountId: "foreign-account" }],
        "brokerage",
      ),
      { state: "integrity_error", reason: "invalid_account_relation" },
    );
    assert.deepEqual(
      projectTenantEventLedgerRows(
        [{ ...BROKERAGE_EVENT, isSample: true }],
        "brokerage",
      ),
      { state: "integrity_error", reason: "sample_row_admitted" },
    );
    assert.deepEqual(
      projectTenantEventLedgerRows(
        [BROKERAGE_EVENT, { ...BROKERAGE_EVENT }],
        "brokerage",
      ),
      { state: "integrity_error", reason: "duplicate_event_row" },
    );
    assert.deepEqual(
      projectTenantEventLedgerRows([ISA_EVENT], "brokerage"),
      { state: "integrity_error", reason: "account_scope_mismatch" },
    );
    assert.deepEqual(
      projectTenantEventLedgerRows(
        [
          BROKERAGE_EVENT,
          {
            ...BROKERAGE_EVENT,
            internalId: "event-other-account",
            legacyBase44Id: "legacy-other-account",
            eventAccountId: "account-other",
            ownedAccountId: "account-other",
          },
        ],
        "all",
      ),
      { state: "integrity_error", reason: "duplicate_account_relation" },
    );
  });

  it("returns explicit no-data evidence without inferring legacy account text", () => {
    assert.deepEqual(projectTenantEventLedgerRows([], "all"), {
      state: "no_data",
      policy: TENANT_EVENT_LEDGER_POLICY,
      scope: "all",
      authorityStatus: "linked_rows_only",
    });
  });

  it("keeps the query and page server-only, tenant-scoped, and identity-minimal", () => {
    const querySource = read("src/db/queries/tenant-events.ts");
    const pageSource = read("src/app/portfolio/events/page.tsx");
    const accountsPageSource = read("src/app/portfolio/accounts/page.tsx");
    const tableSource = read("src/components/events/tenant-event-table.tsx");

    assert.match(querySource, /^import "server-only";/);
    assert.match(querySource, /runTenantReadTransaction/);
    assert.match(querySource, /tenantContext\.ownerUserId/);
    assert.match(
      querySource,
      /inner join public\.accounts as account on event\.account_id = account\.id/,
    );
    assert.match(querySource, /account\.is_active = true/);
    assert.match(querySource, /account\.code = any\(\$2::text\[\]\)/);
    assert.match(querySource, /event\.account = account\.code/);
    assert.match(querySource, /event\.is_sample = false/);
    assert.match(querySource, /limit \$3::integer/);
    assert.doesNotMatch(querySource, /from "@\/db\/client"/);
    assert.doesNotMatch(querySource, /canonical_owner_user_id\s*=/);
    assert.match(pageSource, /resolveCurrentTenantContext\(\)/);
    assert.match(pageSource, /normalizePortfolioAccountScope/);
    assert.match(pageSource, /AccountScopeTabs/);
    assert.match(pageSource, /result\?\.state === "no_data"/);
    assert.match(accountsPageSource, /\/portfolio\/events\?account=all/);
    assert.doesNotMatch(
      `${pageSource}\n${tableSource}`,
      /"use client"|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId|legacyBase44Id|legacyAssetId|correctsEventId/,
    );
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}
