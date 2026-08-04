import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildFrankfurterHistoryUrl,
  parseFrankfurterV2UsdKrwHistory,
} from "../src/lib/market-data/frankfurter-history.ts";

describe("Frankfurter USD/KRW history", () => {
  it("builds a bounded v2 time-series URL", () => {
    const url = new URL(
      buildFrankfurterHistoryUrl("2026-07-09", "2026-08-01"),
    );

    assert.equal(url.origin, "https://api.frankfurter.dev");
    assert.equal(url.pathname, "/v2/rates");
    assert.equal(url.searchParams.get("base"), "USD");
    assert.equal(url.searchParams.get("quotes"), "KRW");
    assert.equal(url.searchParams.get("from"), "2026-07-09");
    assert.equal(url.searchParams.get("to"), "2026-08-01");
  });

  it("parses and orders v2 USD/KRW rows", () => {
    const rows = parseFrankfurterV2UsdKrwHistory([
      { date: "2026-07-10", base: "USD", quote: "KRW", rate: 1510.2 },
      { date: "2026-07-09", base: "USD", quote: "KRW", rate: 1509.13 },
    ]);

    assert.deepEqual(rows, [
      {
        rateDate: "2026-07-09",
        usdKrw: "1509.13",
        source: "frankfurter_v2_blended",
      },
      {
        rateDate: "2026-07-10",
        usdKrw: "1510.2",
        source: "frankfurter_v2_blended",
      },
    ]);
  });

  it("rejects malformed or duplicate rows", () => {
    assert.throws(
      () =>
        parseFrankfurterV2UsdKrwHistory([
          { date: "2026-07-09", base: "EUR", quote: "KRW", rate: 1509.13 },
        ]),
      /invalid/,
    );
    assert.throws(
      () =>
        parseFrankfurterV2UsdKrwHistory([
          { date: "2026-07-09", base: "USD", quote: "KRW", rate: 1509.13 },
          { date: "2026-07-09", base: "USD", quote: "KRW", rate: 1509.13 },
        ]),
      /duplicate/,
    );
  });
});
