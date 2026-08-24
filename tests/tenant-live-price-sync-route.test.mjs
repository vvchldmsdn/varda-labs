import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("tenant live price sync route boundary", () => {
  it("selects exact owner-scoped targets before writing only shared quote cache", () => {
    const route = read("src/app/api/portfolio/live-prices/sync/route.ts");
    const query = read("src/db/queries/tenant-live-price-targets.ts");
    const sync = read("src/lib/market-data/price-sync.ts");
    const writer = read("src/lib/market-data/live-price-write.ts");

    assert.match(route, /export async function POST/);
    assert.match(route, /resolveCurrentTenantContext/);
    assert.match(route, /getTenantLivePriceTargets/);
    assert.match(route, /planTenantLivePriceSync/);
    assert.match(route, /getKisPriceSyncCooldownStatus\("live"\)/);
    assert.match(route, /runMarketPriceSync/);
    assert.match(route, /explicitTargets: \[\.\.\.requestedTargets\]/);
    assert.match(route, /planTenantLiveFxSync/);
    assert.match(route, /createKisProviderRequestSession/);
    assert.match(route, /createKisMarketDataProvider\(session\)/);
    assert.match(route, /fetchKisUsdKrwFxCandidate/);
    assert.match(route, /runUsdKrwFxCandidateJob/);
    assert.match(route, /selectKisUsdKrwQuoteTarget/);
    assert.doesNotMatch(route, /runUsdKrwFxRefreshJob|er-api-open/);
    assert.match(route, /Promise\.all/);
    assert.match(route, /request\.headers\.get\("origin"\) !== url\.origin/);
    assert.match(route, /"Cache-Control": "no-store"/);
    assert.doesNotMatch(route, /KIS_APP_KEY|KIS_APP_SECRET|ownerUserId\s*:/);

    assert.match(query, /^import "server-only";/);
    assert.match(query, /runTenantReadTransaction/);
    assert.match(query, /inner join public\.accounts/);
    assert.match(query, /account\.is_active = true/);
    assert.match(query, /asset\.canonical_owner_user_id = account\.canonical_owner_user_id/);
    assert.match(query, /trim\(asset\.ticker\) <> '-'/);
    assert.doesNotMatch(query, /from "@\/db\/client"|select[\s\S]*owner_user_id\s+as/i);

    assert.match(sync, /authority: "explicit_instrument"/);
    assert.match(writer, /target\.authority !== "explicit_instrument"/);
  });

  it("keeps initial rendering server-side and starts refresh after hydration", () => {
    const page = read("src/app/page.tsx");
    const dashboard = read("src/components/portfolio-dashboard.tsx");
    const button = read("src/components/home/portfolio-refresh-button.tsx");

    assert.match(page, /<PortfolioDashboard data=\{dashboard\} liveSyncEnabled \/>/);
    assert.match(dashboard, /PortfolioRefreshButton autoSync=\{liveSyncEnabled\}/);
    assert.match(button, /^"use client";/);
    assert.match(button, /useEffect/);
    assert.match(button, /sessionStorage/);
    assert.match(button, /method: "POST"/);
    assert.match(button, /\/api\/portfolio\/live-prices\/sync/);
    assert.match(button, /router\.refresh\(\)/);
    assert.doesNotMatch(button, /KIS_APP_KEY|KIS_APP_SECRET|DATABASE_URL/);
  });
});

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
