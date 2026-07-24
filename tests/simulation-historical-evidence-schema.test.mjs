import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const [expandMigration, contractMigration, schema, priceSync, repository, kisProvider] =
  await Promise.all([
  readFile(new URL("../drizzle/0019_lush_maddog.sql", import.meta.url), "utf8"),
  readFile(
    new URL("../drizzle/0020_rainy_northstar.sql", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/db/schema.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/market-data/price-sync.ts", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../src/lib/market-data/asset-price-snapshot-repository.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../src/lib/market-data/providers/kis.ts", import.meta.url),
    "utf8",
  ),
]);

describe("Simulation historical evidence schema expansion", () => {
  it("contracts legacy uniqueness only after exact instrument identity exists", () => {
    assert.match(
      expandMigration,
      /CREATE UNIQUE INDEX "asset_price_snapshots_instrument_date_unique"[\s\S]*"market","currency","ticker","date"/,
    );
    assert.doesNotMatch(
      expandMigration,
      /DROP INDEX "asset_price_snapshots_ticker_date_unique"/i,
    );
    assert.match(
      contractMigration,
      /^DROP INDEX "asset_price_snapshots_ticker_date_unique";\s*$/,
    );
    assert.doesNotMatch(schema, /tickerDateUnique: uniqueIndex/);
    assert.match(schema, /instrumentDateUnique: uniqueIndex/);
  });

  it("is an expand-only metadata migration without row mutation", () => {
    assert.match(
      expandMigration,
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
      assert.match(expandMigration, new RegExp(`ADD COLUMN "${column}"`));
    }
    assert.doesNotMatch(
      `${expandMigration}\n${contractMigration}`,
      /\b(?:insert|update|delete|truncate)\b/i,
    );
  });

  it("uses exact identity for new writes and never labels raw KIS close as adjusted", () => {
    assert.match(
      repository,
      /target: \[[\s\S]*assetPriceSnapshots\.market,[\s\S]*assetPriceSnapshots\.currency,[\s\S]*assetPriceSnapshots\.ticker,[\s\S]*assetPriceSnapshots\.priceDate/,
    );
    assert.match(
      priceSync,
      /operation: "upsert_close_price_by_market_currency_ticker_date"/,
    );
    assert.doesNotMatch(
      priceSync,
      /operation: "upsert_close_price_by_ticker_date"/,
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
