import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("KIS history preview route boundary", () => {
  it("keeps dry-run as default and guards the explicit shared-cache writer", () => {
    const route = read(
      "src/app/api/admin/market/prices/history/route.ts",
    );
    const provider = read("src/lib/market-data/providers/kis.ts");
    const preview = read("src/lib/market-data/kis-history-preview.ts");
    const cacheSync = read(
      "src/lib/market-data/kis-history-cache-sync.ts",
    );
    const repository = read(
      "src/lib/market-data/asset-price-snapshot-repository.ts",
    );

    assert.match(route, /isAuthorizedAdminJob/);
    assert.match(route, /export const runtime = "nodejs"/);
    assert.match(route, /dryRun: true/);
    assert.match(route, /summarizeKisHistoryPreview/);
    assert.match(route, /runKisHistoryCacheSync/);
    assert.doesNotMatch(route, /@\/db\/|assetPriceSnapshots|\.insert\(|\.update\(/);
    assert.doesNotMatch(preview, /@\/db\/|process\.env|fetch\s*\(/);
    assert.match(
      preview,
      /dryRun=false, write=true, and confirmWrite=true/,
    );
    assert.match(cacheSync, /^import "server-only";/);
    assert.match(cacheSync, /asset_price_history_sync/);
    assert.match(cacheSync, /applyAssetPriceSnapshotRows/);
    assert.doesNotMatch(cacheSync, /ownerUserId|owner_user_id|appUserId/);
    assert.match(
      repository,
      /coalesce\(excluded\.asset_id,[\s\S]*assetPriceSnapshots\.assetId/,
    );
    assert.match(
      repository,
      /coalesce\(excluded\.adjusted_close_price,[\s\S]*adjustedClosePrice/,
    );
    assert.match(
      repository,
      /target: \[[\s\S]*market,[\s\S]*currency,[\s\S]*ticker,[\s\S]*priceDate/,
    );
    assert.match(
      repository,
      /assetPriceSnapshots\.source} like 'kis_%'[\s\S]*greatest\(abs\(/,
    );
    assert.doesNotMatch(
      repository,
      /protected_compatible_existing_source/,
    );
    assert.match(provider, /^import "server-only";/);
    assert.match(provider, /fetchHistoricalClosePrices/);
    assert.match(provider, /KIS_RAW_HISTORY_POLICY/);
    assert.match(provider, /adjusted-close and total-return claims remain unset/);
  });
});

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
