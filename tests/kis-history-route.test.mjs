import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("KIS history preview route boundary", () => {
  it("is admin-only, server-only, bounded, and read-only", () => {
    const route = read(
      "src/app/api/admin/market/prices/history/route.ts",
    );
    const provider = read("src/lib/market-data/providers/kis.ts");
    const preview = read("src/lib/market-data/kis-history-preview.ts");

    assert.match(route, /isAuthorizedAdminJob/);
    assert.match(route, /export const runtime = "nodejs"/);
    assert.match(route, /dryRun: true/);
    assert.match(route, /summarizeKisHistoryPreview/);
    assert.doesNotMatch(route, /@\/db\/|assetPriceSnapshots|\.insert\(|\.update\(/);
    assert.doesNotMatch(preview, /@\/db\/|process\.env|fetch\s*\(/);
    assert.match(provider, /^import "server-only";/);
    assert.match(provider, /fetchHistoricalClosePrices/);
    assert.match(provider, /KIS_RAW_HISTORY_POLICY/);
    assert.match(provider, /adjusted-close and total-return claims remain unset/);
  });
});

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
