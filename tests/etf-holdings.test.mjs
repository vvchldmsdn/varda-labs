import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupEtfHoldingRows,
  selectLatestEtfHoldingAsOfDate,
} from "../src/lib/etf-holdings.ts";

function holding(overrides) {
  return {
    id: "row-1",
    legacyBase44Id: "legacy-row-1",
    etfMasterId: "etf-master-1",
    legacyEtfId: "legacy-etf-1",
    etfTicker: "0001S0",
    etfName: "Sample ETF",
    asOfDate: "2026-04-17",
    holdingSymbol: null,
    holdingName: "Sample Holding",
    holdingMarket: "KR",
    holdingCountry: "KR",
    currency: "KRW",
    sector: "Financials",
    industry: "Banking",
    securityType: "bond",
    source: "naver_finance_etf_asset_section_v1",
    rank: 1,
    weightPct: "1.5",
    shares: "10",
    marketValue: "1000",
    ...overrides,
  };
}

describe("ETF holding grouping", () => {
  it("sums same-source duplicate numeric fields and preserves raw row count", () => {
    const grouped = groupEtfHoldingRows([
      holding({
        id: "row-a",
        rank: 2,
        weightPct: "1.25",
        shares: "10",
        marketValue: "1000",
      }),
      holding({
        id: "row-b",
        rank: 1,
        weightPct: "2.75",
        shares: "20",
        marketValue: "2500",
      }),
    ]);

    assert.equal(grouped.rawRowCount, 2);
    assert.equal(grouped.groupedRowCount, 1);
    assert.equal(grouped.duplicateGroupCount, 1);

    const [row] = grouped.groups;
    assert.equal(row.rawRowCount, 2);
    assert.equal(row.hasDuplicates, true);
    assert.equal(row.weightPct.status, "sum");
    assert.equal(row.weightPct.value, 4);
    assert.equal(row.shares.status, "sum");
    assert.equal(row.shares.value, 30);
    assert.equal(row.marketValue.status, "sum");
    assert.equal(row.marketValue.value, 3500);
    assert.equal(row.rank.value, 1);
    assert.equal(row.rank.disagrees, true);
    assert.equal(row.source.value, "naver_finance_etf_asset_section_v1");
    assert.equal(row.rawRows.length, 2);
  });

  it("does not sum grouped numeric values across mixed sources", () => {
    const grouped = groupEtfHoldingRows([
      holding({
        id: "row-a",
        source: "naver_finance_etf_asset_section_v1",
        weightPct: "1",
        shares: "10",
        marketValue: "1000",
      }),
      holding({
        id: "row-b",
        source: "stockanalysis_etf_holdings_v1",
        weightPct: "2",
        shares: "20",
        marketValue: "2000",
      }),
    ]);

    const [row] = grouped.groups;
    assert.equal(row.source.status, "mixed");
    assert.equal(row.source.value, null);
    assert.equal(row.weightPct.status, "multiple_sources");
    assert.equal(row.weightPct.value, null);
    assert.equal(row.shares.status, "multiple_sources");
    assert.equal(row.shares.value, null);
    assert.equal(row.marketValue.status, "multiple_sources");
    assert.equal(row.marketValue.value, null);
  });

  it("sums weight for same-source mixed currency rows but not shares or value", () => {
    const grouped = groupEtfHoldingRows([
      holding({
        id: "row-a",
        currency: "KRW",
        weightPct: "1",
        shares: "10",
        marketValue: "1000",
      }),
      holding({
        id: "row-b",
        currency: "USD",
        weightPct: "2",
        shares: "20",
        marketValue: "2000",
      }),
    ]);

    const [row] = grouped.groups;
    assert.equal(row.currency.status, "mixed");
    assert.equal(row.weightPct.status, "sum");
    assert.equal(row.weightPct.value, 3);
    assert.equal(row.shares.status, "mixed_currency");
    assert.equal(row.shares.value, null);
    assert.equal(row.marketValue.status, "mixed_currency");
    assert.equal(row.marketValue.value, null);
  });

  it("marks descriptive fields as mixed when raw rows disagree", () => {
    const grouped = groupEtfHoldingRows([
      holding({ id: "row-a", sector: "Financials", securityType: "bond" }),
      holding({ id: "row-b", sector: "Technology", securityType: "stock" }),
    ]);

    const [row] = grouped.groups;
    assert.equal(row.sector.status, "mixed");
    assert.equal(row.sector.value, null);
    assert.equal(row.securityType.status, "mixed");
    assert.equal(row.securityType.value, null);
  });

  it("selects the latest as_of_date for an ETF ticker", () => {
    const rows = [
      holding({ id: "row-a", etfTicker: "SPY", asOfDate: "2026-07-01" }),
      holding({ id: "row-b", etfTicker: "SPY", asOfDate: "2026-07-03" }),
      holding({ id: "row-c", etfTicker: "QQQ", asOfDate: "2026-07-05" }),
    ];

    assert.equal(selectLatestEtfHoldingAsOfDate(rows, "spy"), "2026-07-03");
    assert.equal(selectLatestEtfHoldingAsOfDate(rows, "QQQ"), "2026-07-05");
    assert.equal(selectLatestEtfHoldingAsOfDate(rows, "DIA"), null);
  });
});
