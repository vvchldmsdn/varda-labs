import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  FSC_KRX_GOLD_SOURCE_CONTRACT,
  parseFscKrxGoldPriceResponse,
} from "../src/lib/market-data/fsc-krx-gold.ts";
import {
  buildFscKrxGoldCoverageReport,
} from "../src/lib/market-data/fsc-krx-gold-coverage.ts";
import {
  classifyFscKrxGoldMarketDateAvailability,
  resolveFscKrxGoldPublicationSafeEndDate,
} from "../src/lib/market-data/fsc-krx-gold-publication.ts";

const fetchedAt = "2026-07-17T04:00:00.000Z";
const officialGuideFixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/fsc-krx-gold-price-response.json", import.meta.url),
    "utf8",
  ),
);

function providerRow(overrides = {}) {
  return {
    basDt: "20260706",
    srtnCd: "04020000",
    isinCd: "KRD040200002",
    itmsNm: "금 99.99_1Kg",
    clpr: "201000",
    ...overrides,
  };
}

function providerResponse(items, overrides = {}) {
  return {
    response: {
      header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
      body: {
        numOfRows: items.length,
        pageNo: 1,
        totalCount: items.length,
        items: { item: items },
        ...overrides,
      },
    },
  };
}

function parseRows(items) {
  const parsed = parseFscKrxGoldPriceResponse(providerResponse(items), {
    fetchedAt,
  });
  assert.equal(parsed.ok, true);
  return parsed;
}

describe("FSC public-data KRX gold source contract", () => {
  it("pins the reviewed 1kg identity, close field, access, and no-write boundary", () => {
    assert.deepEqual(FSC_KRX_GOLD_SOURCE_CONTRACT.target, {
      productKey: "gold_9999_1kg",
      shortCode: "04020000",
      isin: "KRD040200002",
      itemName: "금 99.99_1Kg",
      quoteKind: "official_close",
      closeField: "clpr",
      priceDateField: "basDt",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_G",
    });
    assert.equal(FSC_KRX_GOLD_SOURCE_CONTRACT.access, "free_auto_approval");
    assert.equal(FSC_KRX_GOLD_SOURCE_CONTRACT.license, "unrestricted");
    assert.deepEqual(
      FSC_KRX_GOLD_SOURCE_CONTRACT.readOnlyDryRunWrites,
      [],
    );
  });

  it("parses the official guide sample without inventing ticker semantics", () => {
    const parsed = parseFscKrxGoldPriceResponse(officialGuideFixture, {
      fetchedAt,
    });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.totalCount, 1);
    assert.deepEqual(parsed.rejectedRows, []);
    assert.deepEqual(parsed.rows[0], {
      priceDate: "2022-09-19",
      shortCode: "04020000",
      isin: "KRD040200002",
      itemName: "금 99.99_1Kg",
      closeKrwPerG: "74560",
      fetchedAt,
      source: "fsc_public_data_gold_daily",
      quoteKind: "official_close",
    });
    assert.equal("ticker" in parsed.rows[0], false);
  });

  it("supports the documented unwrapped root and array item shape", () => {
    const payload = providerResponse([
      providerRow(),
      providerRow({ basDt: "20260707", clpr: 202500 }),
    ]).response;
    const parsed = parseFscKrxGoldPriceResponse(payload, { fetchedAt });

    assert.equal(parsed.ok, true);
    assert.equal(parsed.rows.length, 2);
    assert.deepEqual(
      parsed.rows.map((row) => row.priceDate),
      ["2026-07-06", "2026-07-07"],
    );
  });

  it("fails closed on provider status and reports malformed rows without raw payloads", () => {
    const denied = parseFscKrxGoldPriceResponse({
      response: {
        header: { resultCode: "30", resultMsg: "key rejected" },
        body: {},
      },
    });
    const parsed = parseRows([
      providerRow(),
      providerRow({ basDt: "20260230" }),
      providerRow({ clpr: 0 }),
      providerRow({ isinCd: "" }),
    ]);

    assert.deepEqual(denied, {
      ok: false,
      error: "provider_status_not_success",
      providerResultCode: "30",
    });
    assert.deepEqual(
      parsed.rejectedRows.map((row) => row.reason),
      ["invalid_price_date", "invalid_close", "missing_identity"],
    );
    assert.deepEqual(Object.keys(parsed.rejectedRows[0]), ["index", "reason"]);
  });
});

describe("FSC public-data KRX gold source coverage", () => {
  it("admits an exact complete KRX trading-date range for schema review", () => {
    const parsed = parseRows([
      providerRow(),
      providerRow({ basDt: "20260707", clpr: "202500" }),
      providerRow({ basDt: "20260708", clpr: "203000" }),
    ]);
    const report = buildFscKrxGoldCoverageReport({
      rows: parsed.rows,
      rejectedRowCount: 0,
      fromDate: "2026-07-06",
      toDate: "2026-07-08",
      providerTotalCount: 3,
      fetchedProviderRowCount: 3,
    });

    assert.equal(report.status, "ready_for_schema_review");
    assert.equal(report.expectedTradingDateCount, 3);
    assert.equal(report.observedDateCount, 3);
    assert.deepEqual(report.missingTradingDates, []);
    assert.deepEqual(report.blockedReasons, []);
  });

  it("blocks missing trading dates and both same-value and conflicting duplicates", () => {
    const parsed = parseRows([
      providerRow(),
      providerRow(),
      providerRow({ basDt: "20260708", clpr: "203000" }),
      providerRow({ basDt: "20260708", clpr: "203100" }),
    ]);
    const report = buildFscKrxGoldCoverageReport({
      rows: parsed.rows,
      rejectedRowCount: 0,
      fromDate: "2026-07-06",
      toDate: "2026-07-08",
      providerTotalCount: 4,
      fetchedProviderRowCount: 4,
    });

    assert.equal(report.status, "blocked");
    assert.equal(report.duplicateDateCount, 1);
    assert.equal(report.conflictingCloseDateCount, 1);
    assert.deepEqual(report.missingTradingDates, ["2026-07-07"]);
    assert.ok(report.blockedReasons.includes("duplicate_date_rows"));
    assert.ok(report.blockedReasons.includes("conflicting_close_rows"));
    assert.ok(
      report.blockedReasons.includes("expected_trading_dates_missing"),
    );
  });

  it("blocks partial identity collisions and incomplete pagination", () => {
    const parsed = parseRows([
      providerRow(),
      providerRow({
        basDt: "20260707",
        itmsNm: "unexpected product label",
      }),
      providerRow({ basDt: "20260708", clpr: "203000" }),
    ]);
    const report = buildFscKrxGoldCoverageReport({
      rows: parsed.rows,
      rejectedRowCount: 0,
      fromDate: "2026-07-06",
      toDate: "2026-07-08",
      providerTotalCount: 4,
      fetchedProviderRowCount: 3,
    });

    assert.equal(report.identityConflictCount, 1);
    assert.ok(report.blockedReasons.includes("target_identity_conflict"));
    assert.ok(report.blockedReasons.includes("pagination_incomplete"));
  });

  it("keeps the dry-run script free of database, schema, and write paths", () => {
    const source = readFileSync(
      new URL("../scripts/audit-fsc-krx-gold-source.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /@neondatabase|drizzle|DATABASE_URL/);
    assert.doesNotMatch(source, /insert\(|update\(|delete\(|--write/);
    assert.match(source, /databaseReads:\s*0/);
    assert.match(source, /databaseWrites:\s*0/);
    assert.match(source, /serviceKeyLogged:\s*false/);
  });

  it("uses the next KRX business day 13:00 publication boundary", () => {
    assert.equal(
      resolveFscKrxGoldPublicationSafeEndDate(
        new Date("2026-07-13T00:59:59.000Z"),
      ),
      "2026-07-09",
    );
    assert.equal(
      resolveFscKrxGoldPublicationSafeEndDate(
        new Date("2026-07-13T04:00:00.000Z"),
      ),
      "2026-07-10",
    );
    assert.equal(
      resolveFscKrxGoldPublicationSafeEndDate(
        new Date("2026-07-14T03:59:59.000Z"),
      ),
      "2026-07-10",
    );
    assert.equal(
      resolveFscKrxGoldPublicationSafeEndDate(
        new Date("2026-07-14T04:00:00.000Z"),
      ),
      "2026-07-13",
    );
  });

  it("separates 07:00 source lag from an admitted official close", () => {
    assert.deepEqual(
      classifyFscKrxGoldMarketDateAvailability({
        marketDate: "2026-07-10",
        evaluatedAt: "2026-07-13T00:00:00.000Z",
        providerObservationPresent: false,
      }),
      {
        marketDate: "2026-07-10",
        status: "source_lag_not_published",
        isTradingDate: true,
        providerObservationPresent: false,
        expectedPublicationAt: "2026-07-13T04:00:00.000Z",
        observationAdmission: "do_not_admit",
      },
    );

    assert.equal(
      classifyFscKrxGoldMarketDateAvailability({
        marketDate: "2026-07-10",
        evaluatedAt: "2026-07-13T04:00:00.000Z",
        providerObservationPresent: true,
      }).status,
      "official_close_available",
    );
  });

  it("keeps provider lag distinct after the publication window opens", () => {
    const availability = classifyFscKrxGoldMarketDateAvailability({
      marketDate: "2026-07-13",
      evaluatedAt: "2026-07-14T05:00:00.000Z",
      providerObservationPresent: false,
    });

    assert.equal(availability.status, "source_lag_not_published");
    assert.equal(availability.expectedPublicationAt, "2026-07-14T04:00:00.000Z");
    assert.equal(availability.observationAdmission, "do_not_admit");
  });

  it("does not turn closures or early provider rows into official observations", () => {
    assert.equal(
      classifyFscKrxGoldMarketDateAvailability({
        marketDate: "2026-07-11",
        evaluatedAt: "2026-07-13T05:00:00.000Z",
        providerObservationPresent: false,
      }).status,
      "non_trading_date_no_observation_expected",
    );
    assert.equal(
      classifyFscKrxGoldMarketDateAvailability({
        marketDate: "2026-07-10",
        evaluatedAt: "2026-07-13T03:59:59.000Z",
        providerObservationPresent: true,
      }).status,
      "observation_before_publication_window",
    );
  });
});
