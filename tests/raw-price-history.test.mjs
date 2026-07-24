import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  RawPriceHistoryRequestError,
  buildRawPriceHistoryReadModel,
  normalizeRawPriceHistoryRequest,
} from "../src/lib/market-data/raw-price-history.ts";

describe("Raw price history read model", () => {
  it("normalizes exact instruments without claiming adjusted-return evidence", () => {
    const request = normalizeRawPriceHistoryRequest({
      startDate: "2026-07-01",
      endDate: "2026-07-10",
      instruments: [
        { market: "korea", currency: "KRW", ticker: "069500" },
        { market: "us", currency: "USD", ticker: "qqq" },
      ],
    });

    assert.equal(request.instruments[1].ticker, "QQQ");
    const model = buildRawPriceHistoryReadModel({
      request,
      rows: [
        row("korea", "KRW", "069500", "2026-07-01", "100"),
        row("korea", "KRW", "069500", "2026-07-02", "101"),
        row("us", "USD", "QQQ", "2026-07-01", "500"),
        row("us", "USD", "QQQ", "2026-07-02", "505"),
      ],
    });

    assert.equal(model.status, "ready");
    assert.equal(model.priceBasis, "raw_price_return");
    assert.equal(model.rowCount, 4);
    assert.ok(model.instruments.every(({ status }) => status === "ready"));
    assert.equal("adjustedClosePrice" in model.rows[0], false);
  });

  it("collapses identical duplicates and blocks conflicting dates", () => {
    const request = {
      startDate: "2026-07-01",
      endDate: "2026-07-10",
      instruments: [
        { market: "us", currency: "USD", ticker: "QQQ" },
      ],
    };
    const duplicate = row("us", "USD", "QQQ", "2026-07-01", "500");
    const ready = buildRawPriceHistoryReadModel({
      request,
      rows: [
        duplicate,
        { ...duplicate },
        row("us", "USD", "QQQ", "2026-07-02", "505"),
      ],
    });
    assert.equal(ready.status, "ready");
    assert.equal(ready.duplicateRowCount, 1);
    assert.equal(ready.conflictingDuplicateCount, 0);
    assert.equal(ready.rowCount, 2);

    const blocked = buildRawPriceHistoryReadModel({
      request,
      rows: [duplicate, { ...duplicate, closePrice: "999" }],
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.conflictingDuplicateCount, 1);
    assert.equal(blocked.rowCount, 0);
  });

  it("rejects duplicate identities and oversized ranges", () => {
    assert.throws(
      () =>
        normalizeRawPriceHistoryRequest({
          startDate: "2026-07-01",
          endDate: "2026-07-10",
          instruments: [
            { market: "us", currency: "USD", ticker: "qqq" },
            { market: "us", currency: "USD", ticker: "QQQ" },
          ],
        }),
      RawPriceHistoryRequestError,
    );
    assert.throws(
      () =>
        normalizeRawPriceHistoryRequest({
          startDate: "2024-01-01",
          endDate: "2026-07-10",
          instruments: [
            { market: "us", currency: "USD", ticker: "QQQ" },
          ],
        }),
      RawPriceHistoryRequestError,
    );
  });

  it("keeps the Drizzle query server-only and separate from adjusted close", () => {
    const query = readFileSync(
      new URL("../src/db/queries/raw-price-history.ts", import.meta.url),
      "utf8",
    );
    const adjustedQuery = readFileSync(
      new URL("../src/db/queries/simulation-return-matrix.ts", import.meta.url),
      "utf8",
    );

    assert.match(query, /^import "server-only";/);
    assert.match(query, /assetPriceSnapshots\.closePrice/);
    assert.doesNotMatch(query, /adjustedClosePrice/);
    assert.match(adjustedQuery, /assetPriceSnapshots\.adjustedClosePrice/);
  });
});

function row(market, currency, ticker, priceDate, closePrice) {
  return {
    market,
    currency,
    ticker,
    priceDate,
    closePrice,
    source:
      market === "us"
        ? "kis_overseas_dailyprice:NAS"
        : "kis_domestic_itemchartprice",
    providerSymbol: ticker,
    providerExchange: market === "us" ? "NAS" : "KRX",
    fetchedAt: new Date("2026-07-11T00:00:00.000Z"),
  };
}
