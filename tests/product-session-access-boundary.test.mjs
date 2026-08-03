import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const PRODUCT_PAGES = Object.freeze([
  ["src/app/page.tsx", "getPortfolioDashboard({"],
  ["src/app/today/page.tsx", "getPortfolioDashboard({"],
  [
    "src/app/additional-contribution/page.tsx",
    "getReadOnlyTenantAdditionalContributionPreview({",
  ],
  [
    "src/app/portfolio/structure/page.tsx",
    "getReadOnlyTenantPortfolioStructure({",
  ],
  [
    "src/app/portfolio/risk/page.tsx",
    "getReadOnlyTenantPortfolioRisk({",
  ],
  ["src/app/history/page.tsx", "getReadOnlyTenantHistoryBalance({"],
  [
    "src/app/investment-lab/page.tsx",
    "getReadOnlyTenantPortfolioStructure({",
  ],
  [
    "src/app/simulation/page.tsx",
    "getReadOnlySimulationInputReadiness({",
  ],
  ["src/app/etfs/page.tsx", "searchReadOnlyEtfMasters({"],
  ["src/app/market/page.tsx", "getReadOnlyTenantMarketContext({"],
]);

describe("product session access boundary", () => {
  it("keeps Basic Auth on operator and bootstrap presentation routes only", () => {
    const proxy = read("src/proxy.ts");

    for (const matcher of [
      '"/api/identity/bootstrap-claim/present"',
      '"/auth/callback"',
      '"/admin/:path*"',
    ]) {
      assert.match(proxy, new RegExp(escapeRegExp(matcher)));
    }

    for (const matcher of [
      '"/"',
      '"/api/auth/:path*"',
      '"/auth/sign-in"',
      '"/auth/session"',
      '"/additional-contribution/:path*"',
      '"/portfolio/:path*"',
      '"/etfs"',
      '"/history"',
      '"/investment-lab"',
      '"/market"',
      '"/simulation"',
      '"/today"',
    ]) {
      assert.doesNotMatch(proxy, new RegExp(escapeRegExp(matcher)));
    }
  });

  it("resolves the current product user before every product data read", () => {
    for (const [path, queryMarker] of PRODUCT_PAGES) {
      const source = read(path);
      const resolverIndex = source.indexOf("resolveCurrentTenantContext()");
      const guardIndex = source.indexOf("if (!resolution.ok)");
      const queryIndex = source.indexOf(queryMarker);

      assert.notEqual(resolverIndex, -1, `${path}: resolver missing`);
      assert.notEqual(guardIndex, -1, `${path}: fail-closed guard missing`);
      assert.notEqual(queryIndex, -1, `${path}: query marker missing`);
      assert.ok(
        resolverIndex < guardIndex && guardIndex < queryIndex,
        `${path}: product query starts before authorization succeeds`,
      );
      assert.doesNotMatch(source, /\bfetch\s*\(/, `${path}: browser/API refetch`);
    }
  });

  it("scopes account regime rows through active accounts owned by the tenant", () => {
    const query = read("src/db/queries/market-context.ts");

    assert.match(query, /^import "server-only";/);
    assert.match(query, /tenantContext: TenantContext/);
    assert.match(
      query,
      /innerJoin\(accounts, eq\(marketRegimeDaily\.accountId, accounts\.id\)\)/,
    );
    assert.match(
      query,
      /eq\(accounts\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(query, /eq\(accounts\.isActive, true\)/);
    assert.match(query, /inArray\(accounts\.code, NAMED_PORTFOLIO_ACCOUNTS\)/);
    assert.match(query, /eq\(marketRegimeDaily\.account, accounts\.code\)/);
    assert.doesNotMatch(
      query,
      /\b(?:insert|update|delete|upsert)\s*\(/i,
    );
    assert.doesNotMatch(query, /\bfetch\s*\(|\/api\//);
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
