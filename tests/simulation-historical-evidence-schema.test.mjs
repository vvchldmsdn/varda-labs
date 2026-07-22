import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const [migration, schema, priceSync, kisProvider] = await Promise.all([
  readFile(new URL("../drizzle/0019_lush_maddog.sql", import.meta.url), "utf8"),
  readFile(new URL("../src/db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/market-data/price-sync.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../src/lib/market-data/providers/kis.ts", import.meta.url),
    "utf8",
  ),
]);

describe("Simulation historical evidence schema expansion", () => {
  it("keeps the legacy writer key while adding exact instrument identity", () => {
    assert.match(
      migration,
      /CREATE UNIQUE INDEX "asset_price_snapshots_instrument_date_unique"[\s\S]*"market","currency","ticker","date"/,
    );
    assert.doesNotMatch(
      migration,
      /DROP INDEX "asset_price_snapshots_ticker_date_unique"/i,
    );
    assert.match(schema, /tickerDateUnique: uniqueIndex/);
    assert.match(schema, /instrumentDateUnique: uniqueIndex/);
  });

  it("is an expand-only metadata migration without row mutation", () => {
    assert.match(
      migration,
      /ALTER COLUMN "adjusted_close_price" DROP NOT NULL/,
    );
    for (const column of [
      "adjusted_close_basis",
      "adjusted_close_provider",
      "adjusted_close_source",
      "adjusted_close_fetched_at",
      "provider_symbol",
      "provider_exchange",
      "fetched_at",
    ]) {
      assert.match(migration, new RegExp(`ADD COLUMN "${column}"`));
    }
    assert.doesNotMatch(migration, /\b(?:insert|update|delete|truncate)\b/i);
  });

  it("uses exact identity for new writes and never labels raw KIS close as adjusted", () => {
    assert.match(
      priceSync,
      /target: \[[\s\S]*assetPriceSnapshots\.market,[\s\S]*assetPriceSnapshots\.currency,[\s\S]*assetPriceSnapshots\.ticker,[\s\S]*assetPriceSnapshots\.priceDate/,
    );
    assert.match(kisProvider, /fid_org_adj_prc: "1"/);
    assert.match(
      kisProvider,
      /closePrice: row\.close,[\s\S]*adjustedClosePrice: null,[\s\S]*adjustedCloseBasis: null/,
    );
    assert.doesNotMatch(
      kisProvider,
      /closePrice: row\.close,[\s\S]{0,120}adjustedClosePrice: row\.close/,
    );
  });
});
