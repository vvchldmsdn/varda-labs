import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { projectBrokerRecoveryDisplay, formatBrokerEvidenceMoney } from "../src/lib/broker-recovery-display.ts";

import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

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

describe("tenant event query recovery compatibility", () => {
  it("reads UUID-only trades through real SQL and keeps net settlements separate from unknown gross amounts", async () => {
    const fixture = await recoveryQueryFixture();
    try {
      await fixture.asset({ id: uuid(11), account: uuid(1), owner: uuid(101), archived: true });
      await fixture.event({ id: uuid(21), asset: uuid(11), ticker: "RECOVERY" });
      await fixture.event({ id: uuid(22), source: "manual", legacyAsset: "legacy-only", ticker: "LEGACY", amount: "500", price: "100" });
      // Native cash records intentionally have no asset or legacy asset identity.
      await fixture.event({ id: uuid(23), source: "native_ledger_v1", type: "deposit", ticker: "NATIVE", quantity: null });

      const result = await fixture.read(uuid(101));
      assert.equal(result.state, "partial");
      assert.equal(result.eventCount, 3);
      const recovered = result.events.find(row => row.ticker === "RECOVERY");
      assert.equal(recovered.assetReferenceStatus, "stored_asset_reference");
      assert.equal(recovered.evidenceStatus, "partial");
      assert.deepEqual(recovered.missingFields, ["amount_krw", "price"]);
      assert.equal(recovered.quantityDelta, -0.125);
      assert.equal(recovered.eventDate, "2026-07-02");
      assert.equal(recovered.amountKrw, null);
      assert.equal(recovered.price, null);
      assert.equal(recovered.fxRate, null);
      assert.equal(result.events.find(row => row.ticker === "LEGACY").assetReferenceStatus, "legacy_only");
      assert.equal(result.events.find(row => row.ticker === "NATIVE").amountKrw, null);
      assert.deepEqual(recovered.brokerEvidence, {
        executionGross: null, originalDisplay: { currency: "KRW", amount: "18000" },
        cashSettlement: { currency: "USD", amount: "12.49", date: "2026-07-06" },
      });
      assert.doesNotMatch(JSON.stringify(result), /brokerRecoveryData|canonicalOwner|legacy-only|00000000-0000|private-source|operator-row/);
    } finally {
      await fixture.close();
    }
  });

  it("requires recovery assets to match the session owner and account without borrowing ticker or legacy identity", async () => {
    const fixture = await recoveryQueryFixture();
    try {
      await fixture.asset({ id: uuid(11), account: uuid(1), owner: uuid(101) });
      await fixture.asset({ id: uuid(12), account: uuid(2), owner: uuid(101) });
      await fixture.asset({ id: uuid(13), account: uuid(1), owner: uuid(102) });
      await fixture.asset({ id: uuid(14), account: uuid(3), owner: uuid(102) });
      await fixture.event({ id: uuid(21), asset: uuid(11), ticker: "OWNED" });
      await fixture.event({ id: uuid(22), asset: uuid(12), ticker: "WRONG_ACCOUNT" });
      await fixture.event({ id: uuid(23), asset: uuid(13), ticker: "FOREIGN_ASSET" });
      await fixture.event({ id: uuid(24), asset: uuid(99), ticker: "MISSING_ASSET" });
      await fixture.event({ id: uuid(25), ticker: "MISSING_REFERENCE", legacyAsset: "do-not-infer" });
      await fixture.event({ id: uuid(26), asset: uuid(11), ticker: "SAMPLE", sample: true });
      await fixture.event({ id: uuid(27), asset: uuid(14), account: uuid(3), owner: uuid(102), ticker: "OTHER_OWNER" });
      // Even an event linked to a visible account must pass the event's own RLS.
      await fixture.event({ id: uuid(28), asset: uuid(11), owner: uuid(102), ticker: "FOREIGN_EVENT" });

      const result = await fixture.read(uuid(101));
      assert.equal(result.state, "partial");
      assert.deepEqual(result.events.map(row => row.ticker), ["OWNED"]);
      assert.deepEqual((await fixture.read(uuid(102))).events.map(row => row.ticker), ["OTHER_OWNER"]);
      assert.equal((await fixture.read(uuid(101), "isa")).state, "no_data");
      assert.deepEqual((await fixture.read(uuid(101), "all")).events.map(row => row.ticker), ["OWNED"]);
    } finally {
      await fixture.close();
    }
  });
});

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

async function recoveryQueryFixture() {
  // Disposable in-memory PostgreSQL only. No env or application DB client is loaded.
  const pg = new PGlite();
  await pg.exec(`
    create role event_query_test;
    create table accounts(id uuid primary key, canonical_owner_user_id uuid, code text, name text, sort_order integer, is_active boolean);
    create table assets(id uuid primary key, canonical_owner_user_id uuid, account_id uuid, account text, archived_at timestamptz);
    create table event_ledger_entries(
      id uuid primary key, canonical_owner_user_id uuid, account_id uuid, account text, legacy_base44_id text,
      is_sample boolean default false, event_date date, event_type text, source text, recorded_at timestamptz, rule_version text,
      asset_id uuid, legacy_asset_id text, ticker text, asset_name text, group_name text, corrects_event_id uuid,
      legacy_corrects_event_id text, amount_krw numeric, quantity_delta numeric, price numeric, fx_rate numeric,
      broker_recovery_data jsonb, created_at timestamptz default now()
    );
    grant select on accounts, assets, event_ledger_entries to event_query_test;
    ${["accounts", "assets", "event_ledger_entries"].map(table => `
      alter table ${table} enable row level security;
      create policy owner_read on ${table} for select to event_query_test
        using(canonical_owner_user_id = current_setting('app.current_user_id', true)::uuid);
    `).join("\n")}
  `);
  for (const [id, owner, code] of [[uuid(1), uuid(101), "brokerage"], [uuid(2), uuid(101), "isa"], [uuid(3), uuid(102), "brokerage"]]) {
    await pg.query("insert into accounts values($1,$2,$3,$3,10,true)", [id, owner, code]);
  }
  const [query] = await importWithPorts(["src/db/queries/tenant-events.ts"], {
    "@/db/tenant-transaction-context": {
      runTenantReadTransaction: (owner, build) => pg.transaction(async tx => {
        await tx.exec("set local role event_query_test");
        await tx.query("select set_config('app.current_user_id',$1,true)", [owner]);
        return Promise.all(build({ query: async (sql, parameters) => (await tx.query(sql, parameters)).rows }));
      }),
    },
  });
  return {
    close: () => pg.close(),
    read: (owner, scope = "brokerage") => query.getReadOnlyTenantEvents({ tenantContext: { ownerUserId: owner }, scope }),
    asset: ({ id, account, owner, archived = false }) => pg.query(
      "insert into assets values($1,$2,$3,(select code from accounts where id=$3),$4)",
      [id, owner, account, archived ? "2026-07-03T00:00:00Z" : null],
    ),
    event: ({ id, asset = null, account = uuid(1), owner = uuid(101), source = "broker_recovery_v1", type = "sell", ticker, legacyAsset = null, amount = null, price = null, quantity = "-0.125", sample = false }) => pg.query(`
      insert into event_ledger_entries(
        id,canonical_owner_user_id,account_id,account,event_date,event_type,source,rule_version,
        recorded_at,asset_id,legacy_asset_id,ticker,asset_name,amount_krw,quantity_delta,price,broker_recovery_data,is_sample
      ) values($1,$2,$3,(select code from accounts where id=$3),'2026-07-02',$4,$5,$5,
        '2026-07-08T00:00:00Z',$6,$7,$8,$8,$9,$10,$11,$12,$13)
    `, [id, owner, account, type, source, asset, legacyAsset, ticker, amount, quantity, price,
      JSON.stringify({ version: 1, tradeDate: "2026-07-02", side: type, quantity: "0.125", originalDisplay: { currency: "KRW", amount: "18000" }, cashSettlement: { currency: "USD", amount: "12.49", date: "2026-07-06" }, evidence: ["private-source"], rowId: "operator-row" }), sample]),
  };
}

function read(path) {
  return readFileSync(path, "utf8");
}

describe("broker evidence presentation", () => {
  const event = { source: "broker_recovery_v1", eventDate: "2026-07-02", eventType: "sell", quantityDelta: "-2" };
  const data = { version: 1, tradeDate: "2026-07-02", side: "sell", quantity: "2", executionGross: { amount: "200.02", currency: "USD" }, originalDisplay: { amount: "280028", currency: "KRW" }, cashSettlement: { amount: "199.91", currency: "USD", date: "2026-07-06" }, rowId: "private-operator-row", evidence: ["private-source-path"] };

  it("keeps independently supplied gross, display, net and dates separate without estimating charges or FX", () => {
    const result = projectBrokerRecoveryDisplay(data, event);
    assert.deepEqual(result, { executionGross: { amount: "200.02", currency: "USD" }, originalDisplay: { amount: "280028", currency: "KRW" }, cashSettlement: { amount: "199.91", currency: "USD", date: "2026-07-06" } });
    assert.doesNotMatch(JSON.stringify(result), /private|fee|tax|fxRate/);
    assert.equal(formatBrokerEvidenceMoney({ currency: "USD", amount: "12345678901234.12" }), "$12,345,678,901,234.12");
    assert.equal(formatBrokerEvidenceMoney({ currency: "USD", amount: "2.5" }), "$2.50");
    assert.equal(formatBrokerEvidenceMoney({ currency: "KRW", amount: "1000" }), "1,000원");
  });

  it("does not admit mismatched provenance, sign, date, invalid currency or impossible settlement dates", () => {
    for (const changes of [{ version: 2 }, { side: "buy" }, { quantity: "3" }, { quantity: "-2" }, { tradeDate: "2026-07-03" }]) {
      assert.equal(projectBrokerRecoveryDisplay({ ...data, ...changes }, event), null);
    }
    assert.equal(projectBrokerRecoveryDisplay(data, { ...event, source: "manual" }), null);
    assert.equal(projectBrokerRecoveryDisplay(data, { ...event, quantityDelta: "2" }), null);
    for (const invalid of [{ amount: "NaN", currency: "USD" }, { amount: "1.001", currency: "USD" }, { amount: "1.2", currency: "KRW" }, { amount: "0", currency: "USD" }, { amount: "10", currency: "EUR" }]) {
      assert.equal(projectBrokerRecoveryDisplay({ ...data, executionGross: invalid }, event).executionGross, null);
    }
    for (const date of ["2026-02-30", "2026-07-01", "not-a-date"]) {
      assert.equal(projectBrokerRecoveryDisplay({ ...data, cashSettlement: { ...data.cashSettlement, date } }, event).cashSettlement, null);
    }
  });

  it("renders recovery amounts and settlement date as distinct expandable facts", async () => {
    const [{ BrokerEvidenceDetails }, { TenantEventTable }] = await importUiWithPorts(["src/components/events/broker-evidence-details.tsx", "src/components/events/tenant-event-table.tsx"], {
      "@/components/i18n/localized-text": { T: ({ ko }) => ko },
    });
    const html = renderToStaticMarkup(createElement(BrokerEvidenceDetails, { evidence: projectBrokerRecoveryDisplay(data, event) }));
    assert.match(html, /<details/); assert.match(html, /<summary/);
    assert.match(html, /거래금액/); assert.match(html, /\$200\.02/);
    assert.match(html, /주문 표시액/); assert.match(html, /280,028원/);
    assert.match(html, /실제 결제액/); assert.match(html, /\$199\.91/);
    assert.match(html, /2026-07-06/); assert.match(html, /수수료·세금 구분 미확인/);
    assert.doesNotMatch(html, /private|0\.11/);
    const rows = projectTenantEventLedgerRows([{ ...BROKERAGE_EVENT, ...event, brokerRecoveryData: { ...data, executionGross: null }, amountKrw: null, price: null }], "brokerage").events;
    const table = renderToStaticMarkup(createElement(TenantEventTable, { events: rows }));
    assert.match(table, /결제액/); assert.match(table, /\$199\.91/);
    assert.doesNotMatch(table, /\$200\.02|private/);
    const withOrder = projectBrokerRecoveryDisplay({ ...data, orderUnitPrice: { currency: "USD", amount: "99.98765" } }, event);
    assert.deepEqual(withOrder.orderUnitPrice, { currency: "USD", amount: "99.98765" });
    assert.deepEqual(withOrder.executionGross, { amount: "200.02", currency: "USD" });
    const orderHtml = renderToStaticMarkup(createElement(BrokerEvidenceDetails, { evidence: withOrder }));
    assert.match(orderHtml, /주문 단가/); assert.match(orderHtml, /\$99\.98765/);
    assert.match(orderHtml, /\$200\.02/); assert.match(orderHtml, /\$199\.91/);
    assert.equal(projectBrokerRecoveryDisplay({ ...data, orderUnitPrice: { currency: "USD", amount: "NaN" } }, event).orderUnitPrice, undefined);
  });
});


it("labels recovered trades in the selected language without displaying import time as execution time", async () => {
  for (const locale of ["ko", "en"]) {
    const [{ TenantEventTable }] = await importUiWithPorts(["src/components/events/tenant-event-table.tsx"], {
      "@/components/i18n/localized-text": { T: ({ ko, en }) => locale === "en" ? en : ko },
    });
    const input = { ...BROKERAGE_EVENT, source: "broker_recovery_v1", recordedAt: "2026-07-19T17:43:21.000Z" };
    const rows = projectTenantEventLedgerRows([input], "brokerage").events;
    const html = renderToStaticMarkup(createElement(TenantEventTable, { events: rows }));
    assert.match(html, locale === "en" ? /Recovered trade/ : /거래내역 복구/);
    assert.match(html, /2026-07-02/);
    assert.doesNotMatch(html, /broker_recovery_v1|2026-07-19|17:43:21/);
    const ordinary = renderToStaticMarkup(createElement(TenantEventTable, { events: [{ ...rows[0], source: "manual" }] }));
    assert.match(ordinary, /manual/);
    assert.match(ordinary, /2026-07-19 17:43:21 UTC/);
  }
});
