import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const PRODUCT_PAGES = Object.freeze([
  ["src/app/page.tsx", ["getPortfolioDashboard({"]],
  ["src/app/today/page.tsx", ["getPortfolioDashboard({"]],
  [
    "src/app/additional-contribution/page.tsx",
    ["getReadOnlyTenantAdditionalContributionPreviewForScope({"],
  ],
  [
    "src/app/portfolio/structure/page.tsx",
    ["getReadOnlyTenantPortfolioTargetPolicyModel({"],
  ],
  [
    "src/app/portfolio/risk/page.tsx",
    ["getReadOnlyTenantPortfolioRiskForScope({"],
  ],
  [
    "src/app/history/page.tsx",
    ["getReadOnlyTenantHistoryBalance({", "getReadOnlyTenantEvents({"],
  ],
  [
    "src/app/investment-lab/page.tsx",
    [
      "getReadOnlyTenantInvestmentLabAnalysisScopeEvidence({",
      "getReadOnlyTenantPortfolioStructureForScope({",
      "getReadOnlyTenantInvestmentLabDataAvailabilityForScope({",
      "getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio(",
      "getReadOnlyTenantInvestmentLabCounterfactualForScope({",
      "getReadOnlyTenantInvestmentLabStressReplay({",
    ],
  ],
  [
    "src/app/simulation/page.tsx",
    [
      "getReadOnlySimulationInputReadiness({",
      "getReadOnlyTenantSimulationOwnerResearch({",
      "getReadOnlySimulationHistoricalOutcomeValidation({",
      "getReadOnlySimulationRegimeBootstrap({",
      "getReadOnlySimulationRegimeHistoricalOutcomeValidation({",
      "getReadOnlySimulationResearchUniversePreflight({",
    ],
  ],
  ["src/app/etfs/page.tsx", ["searchReadOnlyEtfMasters({"]],
  ["src/app/market/page.tsx", ["getReadOnlyTenantMarketContext({"]],
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
    for (const [path, queryMarkers] of PRODUCT_PAGES) {
      const source = read(path);
      const resolverIndex = source.indexOf("resolveCurrentTenantContext()");
      const guardIndex = source.indexOf("if (!resolution.ok)");

      assert.notEqual(resolverIndex, -1, `${path}: resolver missing`);
      assert.notEqual(guardIndex, -1, `${path}: fail-closed guard missing`);
      for (const queryMarker of queryMarkers) {
        const queryIndex = source.indexOf(queryMarker);

        assert.notEqual(
          queryIndex,
          -1,
          `${path}: ${queryMarker} query marker missing`,
        );
        assert.ok(
          resolverIndex < guardIndex && guardIndex < queryIndex,
          `${path}: ${queryMarker} starts before authorization succeeds`,
        );
      }
      assert.doesNotMatch(source, /\bfetch\s*\(/, `${path}: browser/API refetch`);
    }
  });

  it("derives Simulation owner inputs from the resolved tenant portfolio", () => {
    const page = read("src/app/simulation/page.tsx");
    const query = read("src/db/queries/simulation-owner-research.ts");

    assert.match(
      page,
      /getReadOnlyTenantSimulationOwnerResearch\(\{[\s\S]*scope: selectedScope,[\s\S]*tenantContext: resolution\.tenantContext/,
    );
    assert.match(query, /^import "server-only";/);
    assert.match(query, /tenantContext: TenantContext/);
    assert.match(
      query,
      /getReadOnlyTenantPortfolioStructure\(\{[\s\S]*tenantContext: options\.tenantContext,[\s\S]*account: options\.account/,
    );
    assert.match(
      query,
      /getReadOnlyTenantPortfolioStructureForScope\(\{[\s\S]*scope: options\.scope,[\s\S]*serviceDate: options\.serviceDate/,
    );
    assert.ok(
      query.indexOf("buildSimulationOwnerInputCandidate({") <
        query.indexOf("getLatestCommonPrivateOwnerRawServiceDate({") &&
        query.indexOf("buildSimulationOwnerInputCandidate({") <
          query.indexOf("getReadOnlyPrivateOwnerRawHistoryValidationBatch({"),
      "shared price and FX evidence must be selected after the owned portfolio candidate",
    );
    assert.doesNotMatch(
      query,
      /ownerUserId\s*:\s*string|searchParams|NextRequest|headers\(\)|cookies\(\)/,
    );
  });

  it("scopes account regime rows through active accounts owned by the tenant", () => {
    const query = read("src/db/queries/market-context.ts");
    const tenantQuery = read("src/db/queries/tenant-market-regimes.ts");

    assert.match(query, /^import "server-only";/);
    assert.match(query, /tenantContext: TenantContext/);
    assert.match(query, /loadTenantMarketRegimeRows\(tenantContext\)/);
    assert.match(tenantQuery, /runTenantReadTransaction/);
    assert.match(tenantQuery, /inner join public\.accounts as account/);
    assert.match(tenantQuery, /account\.is_active = true/);
    assert.match(tenantQuery, /regime\.account = account\.code/);
    assert.doesNotMatch(
      tenantQuery,
      /canonical_owner_user_id|owner_user_id|NAMED_PORTFOLIO_ACCOUNTS/,
    );
    assert.doesNotMatch(
      `${query}\n${tenantQuery}`,
      /\b(?:insert|update|delete|upsert)\s*\(/i,
    );
    assert.doesNotMatch(`${query}\n${tenantQuery}`, /\bfetch\s*\(|\/api\//);
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
