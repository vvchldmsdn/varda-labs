import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

describe("current tenant read scope runtime boundary", () => {
  it("resolves one server session through explicit identity and app-user tables", () => {
    const source = read(
      "src/lib/auth/current-tenant-context.ts",
    );

    assert.match(source, /^import "server-only";/);
    for (const marker of [
      "cache(",
      "getAuthTransportRuntime",
      "auth.getSession()",
      "authIdentities.provider",
      "authIdentities.providerSubject",
      "authIdentities.appUserId",
      "appUsers.id",
      ".limit(2)",
      "resolveSessionToAppUser",
    ]) {
      assert.match(source, new RegExp(escapeRegExp(marker)), marker);
    }
    assert.doesNotMatch(
      source,
      /console\.|NextResponse|Response\(|insert\s*\(|update\s*\(|delete\s*\(|\.insert\(|\.update\(|\.delete\(/i,
    );
  });

  it("filters accounts by canonical owner before account scope", () => {
    const source = read("src/db/queries/tenant-accounts.ts");

    assert.match(source, /^import "server-only";/);
    assert.match(
      source,
      /eq\(accounts\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId\)/,
    );
    assert.match(source, /inArray\(accounts\.code,\s*NAMED_PORTFOLIO_ACCOUNTS\)/);
    assert.match(source, /scope !== "all"/);
    assert.doesNotMatch(
      source,
      /ownerUserId\s*:\s*string|searchParams|NextRequest|headers\(\)|cookies\(\)/,
    );
  });

  it("projects only public evidence on the account-scope page", () => {
    const source = read("src/app/portfolio/accounts/page.tsx");

    assert.match(source, /resolveCurrentTenantContext\(\)/);
    assert.match(source, /getReadOnlyTenantAccounts/);
    assert.match(source, /normalizePortfolioAccountScope/);
    assert.match(source, /sessionResolutionEvidence\(resolution\)/);
    assert.doesNotMatch(
      source,
      /providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId/,
    );
  });

  it("authorizes holdings through the owned account relationship", () => {
    const source = read("src/db/queries/tenant-holdings.ts");
    const targetSource = read(
      "src/db/queries/portfolio-analysis-scope-targets.ts",
    );

    assert.match(source, /^import "server-only";/);
    assert.match(
      source,
      /innerJoin\(accounts,\s*eq\(assets\.accountId,\s*accounts\.id\)\)/,
    );
    assert.match(
      source,
      /eq\(accounts\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId\)/,
    );
    assert.match(source, /eq\(accounts\.isActive,\s*true\)/);
    assert.match(
      source,
      /eq\(assets\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId\)/,
    );
    assert.match(source, /eq\(assets\.account,\s*accounts\.code\)/);
    assert.match(source, /getPortfolioAnalysisScopeTargets/);
    assert.match(targetSource, /^import "server-only";/);
    assert.match(targetSource, /portfolioGroupAccountMemberships/);
    assert.match(targetSource, /portfolioGroupAssetMemberships/);
    assert.match(targetSource, /selectDistinct/);
    assert.match(targetSource, /lte\(portfolioGroupAccountMemberships\.validFrom, serviceDate\)/);
    assert.match(targetSource, /gt\(portfolioGroupAssetMemberships\.validTo, serviceDate\)/);
    assert.doesNotMatch(
      source,
      /NAMED_PORTFOLIO_ACCOUNTS|ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)/,
    );
  });

  it("keeps the holdings canary server-rendered and identity-minimal", () => {
    const source = read("src/app/portfolio/holdings/page.tsx");

    assert.match(source, /resolveCurrentTenantContext\(\)/);
    assert.match(source, /getReadOnlyTenantHoldings/);
    assert.match(source, /getReadOnlyTenantPortfolioAnalysisScopeContext/);
    assert.match(source, /PortfolioAnalysisScopeTabs/);
    assert.match(source, /resolveSnapshotCycle\(\)\.snapshotDate/);
    assert.match(source, /Promise\.all/);
    assert.match(source, /holdingReadEvidence\(/);
    assert.match(source, /result\.state === "partial"/);
    assert.match(source, /must not be used for valuation totals/);
    assert.doesNotMatch(
      source,
      /"use client"|providerSubject|canonicalOwnerUserId|legacyBase44Id/,
    );
  });

  it("authorizes position snapshots only through active owned accounts", () => {
    const source = read("src/db/queries/tenant-position-snapshots.ts");

    assert.match(source, /^import "server-only";/);
    assert.match(
      source,
      /innerJoin\(\s*accounts,\s*eq\(dailyPositionSnapshots\.accountId,\s*accounts\.id\)/,
    );
    assert.match(
      source,
      /eq\(accounts\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId\)/,
    );
    assert.match(source, /eq\(accounts\.isActive,\s*true\)/);
    assert.match(source, /inArray\(accounts\.code,\s*NAMED_PORTFOLIO_ACCOUNTS\)/);
    assert.match(
      source,
      /eq\(dailyPositionSnapshots\.account,\s*accounts\.code\)/,
    );
    assert.match(source, /eq\(dailyPositionSnapshots\.isSample,\s*false\)/);
    assert.doesNotMatch(
      source,
      /eq\(dailyPositionSnapshots\.(?:canonicalOwnerUserId|legacyAssetId|ticker)|ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)/,
    );
  });

  it("keeps the position-snapshot canary server-rendered and identity-minimal", () => {
    const source = read("src/app/portfolio/position-snapshots/page.tsx");

    assert.match(source, /resolveCurrentTenantContext\(\)/);
    assert.match(source, /getReadOnlyTenantPositionSnapshots/);
    assert.match(source, /parseTenantPositionSnapshotDateQuery/);
    assert.match(source, /AccountScopeTabs/);
    assert.match(source, /Partial evidence only/);
    assert.match(
      source,
      /Do not use this\s+view for portfolio totals or decision support/,
    );
    assert.doesNotMatch(
      source,
      /"use client"|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId|legacyBase44Id|legacyAssetId/,
    );
  });

  it("authorizes portfolio snapshots only through named active owned accounts", () => {
    const source = read("src/db/queries/tenant-portfolio-snapshots.ts");

    assert.match(source, /^import "server-only";/);
    assert.match(
      source,
      /innerJoin\(\s*accounts,\s*eq\(dailyPortfolioSnapshots\.accountId,\s*accounts\.id\)/,
    );
    assert.match(
      source,
      /eq\(accounts\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId\)/,
    );
    assert.match(source, /eq\(accounts\.isActive,\s*true\)/);
    assert.match(source, /inArray\(accounts\.code,\s*NAMED_PORTFOLIO_ACCOUNTS\)/);
    assert.match(
      source,
      /eq\(dailyPortfolioSnapshots\.account,\s*accounts\.code\)/,
    );
    assert.match(source, /eq\(dailyPortfolioSnapshots\.isSample,\s*false\)/);
    assert.doesNotMatch(
      source,
      /eq\(dailyPortfolioSnapshots\.canonicalOwnerUserId|ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)/,
    );
  });

  it("keeps the portfolio-snapshot canary server-rendered and identity-minimal", () => {
    const source = read("src/app/portfolio/portfolio-snapshots/page.tsx");
    const summarySource = read(
      "src/components/portfolio-snapshots/portfolio-snapshot-summary.tsx",
    );

    assert.match(source, /resolveCurrentTenantContext\(\)/);
    assert.match(source, /getReadOnlyTenantPortfolioSnapshots/);
    assert.match(source, /parseTenantSnapshotDateQuery/);
    assert.match(source, /PortfolioSnapshotControls/);
    assert.match(source, /PortfolioSnapshotSummary/);
    assert.match(source, /PortfolioSnapshotTable/);
    assert.match(summarySource, /Available-account subtotal/);
    assert.match(
      summarySource,
      /stored account=all row is not an ownership authority/,
    );
    assert.doesNotMatch(
      `${source}\n${summarySource}`,
      /"use client"|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId|legacyBase44Id/,
    );
  });

  it("keeps history server-rendered and scoped through the resolved tenant", () => {
    const pageSource = read("src/app/history/page.tsx");
    const querySource = read("src/db/queries/history-balance.ts");
    const controlsSource = read("src/components/history/history-controls.tsx");

    assert.match(pageSource, /resolveCurrentTenantContext\(\)/);
    assert.match(pageSource, /getReadOnlyTenantHistoryBalance/);
    assert.match(pageSource, /getReadOnlyTenantEvents/);
    assert.match(
      pageSource,
      /getReadOnlyTenantPortfolioAnalysisScopeContext/,
    );
    assert.match(pageSource, /PortfolioAnalysisScopeBoundary/);
    assert.match(pageSource, /if \(!resolution\.ok\)/);
    assert.match(pageSource, /Promise\.all/);
    assert.doesNotMatch(pageSource, /fetch\(|\/api\//);

    assert.match(querySource, /^import "server-only";/);
    assert.match(
      querySource,
      /accounts\.canonicalOwnerUserId, tenantContext\.ownerUserId/,
    );
    assert.match(
      querySource,
      /accountBalanceSnapshots\.canonicalOwnerUserId,[\s\S]*tenantContext\.ownerUserId/,
    );
    assert.match(querySource, /innerJoin\(accounts/);
    assert.match(querySource, /dailyPortfolioSnapshots\.account, accounts\.code/);
    assert.match(querySource, /dailyPositionSnapshots\.account, accounts\.code/);
    assert.match(querySource, /buildPortfolioGroupHistoryRows/);
    assert.match(querySource, /portfolioGroupAccountMemberships\.validFrom/);
    assert.match(querySource, /portfolioGroupAssetMemberships\.validFrom/);
    assert.doesNotMatch(querySource, /NAMED_PORTFOLIO_ACCOUNTS/);
    assert.doesNotMatch(querySource, /ownerUserId\s*:\s*string|headers\(\)|cookies\(\)/);
    assert.match(controlsSource, /PortfolioAnalysisScopeTabs/);
    assert.match(controlsSource, /name="scope"/);
    assert.doesNotMatch(controlsSource, /name="account"/);
  });

  it("authorizes dashboard rows through dynamic accounts and effective group targets", () => {
    const source = read("src/db/queries/portfolio-dashboard.ts");
    const targetSource = read(
      "src/db/queries/portfolio-analysis-scope-targets.ts",
    );

    assert.match(source, /^import "server-only";/);
    assert.match(
      source,
      /eq\(accounts\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(source, /eq\(accounts\.isActive, true\)/);
    assert.match(source, /getPortfolioAnalysisScopeTargets/);
    assert.match(source, /targets\.wholeAccountIds/);
    assert.match(source, /targets\.directAssetIds/);
    assert.match(
      source,
      /eq\(assets\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.doesNotMatch(source, /NAMED_PORTFOLIO_ACCOUNTS/);
    assert.match(targetSource, /lte\(portfolioGroupAccountMemberships\.validFrom, serviceDate\)/);
    assert.match(targetSource, /gt\(portfolioGroupAssetMemberships\.validTo, serviceDate\)/);
    for (const relation of [
      /innerJoin\(accounts, eq\(assets\.accountId, accounts\.id\)\)/,
      /eq\(assets\.account, accounts\.code\)/,
      /innerJoin\(accounts, eq\(eventLedgerEntries\.accountId, accounts\.id\)\)/,
      /eq\(eventLedgerEntries\.account, accounts\.code\)/,
      /innerJoin\(accounts, eq\(dailyPositionSnapshots\.accountId, accounts\.id\)\)/,
      /eq\(dailyPositionSnapshots\.account, accounts\.code\)/,
      /innerJoin\(accounts, eq\(dailyPortfolioSnapshots\.accountId, accounts\.id\)\)/,
      /eq\(dailyPortfolioSnapshots\.account, accounts\.code\)/,
    ]) {
      assert.match(source, relation);
    }
    assert.doesNotMatch(
      source,
      /ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)/,
    );
  });

  it("keeps home and today reads behind the resolved server session", () => {
    for (const path of ["src/app/page.tsx", "src/app/today/page.tsx"]) {
      const source = read(path);

      assert.match(source, /resolveCurrentTenantContext\(\)/);
      assert.match(source, /if \(!resolution\.ok\)/);
      assert.match(source, /PortfolioDashboardAccessBoundary/);
      assert.match(source, /getReadOnlyTenantPortfolioAnalysisScopeContext/);
      assert.match(source, /PortfolioAnalysisScopeBoundary/);
      assert.match(
        source,
        /getPortfolioDashboard\(\{[\s\S]*analysisScopes:[\s\S]*scope:[\s\S]*tenantContext: resolution\.tenantContext/,
      );
      assert.doesNotMatch(source, /fetch\(|\/api\//);
    }
  });

  it("keeps home and today navigation on the shared dynamic scope catalog", () => {
    for (const path of [
      "src/components/portfolio-dashboard.tsx",
      "src/components/today-movement.tsx",
    ]) {
      const source = read(path);

      assert.match(source, /PortfolioAnalysisScopeTabs/);
      assert.match(source, /data\.analysisScopes/);
      assert.match(source, /data\.selectedScope\.key/);
      assert.doesNotMatch(
        source,
        /DASHBOARD_ACCOUNT_TABS|TODAY_ACCOUNT_TABS|NAMED_PORTFOLIO_ACCOUNTS/,
      );
    }
  });

  it("authorizes portfolio structure through owned accounts and owner-scoped groups", () => {
    const source = read("src/db/queries/portfolio-structure.ts");

    assert.match(source, /^import "server-only";/);
    assert.match(source, /getReadOnlyTenantPortfolioStructure/);
    assert.match(source, /getReadOnlyTenantPortfolioStructureForScope/);
    assert.match(source, /getPortfolioAnalysisScopeTargets/);
    assert.match(
      source,
      /innerJoin\(accounts, eq\(assets\.accountId, accounts\.id\)\)/,
    );
    assert.match(
      source,
      /eq\(accounts\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(source, /eq\(accounts\.isActive, true\)/);
    assert.match(source, /inArray\(accounts\.code, NAMED_PORTFOLIO_ACCOUNTS\)/);
    assert.match(source, /eq\(assets\.account, accounts\.code\)/);
    assert.match(
      source,
      /eq\(assets\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(
      source,
      /eq\(assetGroups\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(
      source,
      /eq\(\s*assetGroupMembers\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId/,
    );
    assert.match(source, /eq\(assetGroupMembers\.groupId, assets\.groupId\)/);
    assert.match(
      source,
      /eq\(settings\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.doesNotMatch(
      source,
      /ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)/,
    );
  });

  it("keeps portfolio structure behind the resolved server session", () => {
    const source = read("src/app/portfolio/structure/page.tsx");

    assert.match(source, /resolveCurrentTenantContext\(\)/);
    assert.match(source, /Promise\.all/);
    assert.match(source, /if \(!resolution\.ok\)/);
    assert.match(source, /PortfolioReadAccessBoundary/);
    assert.match(source, /getReadOnlyTenantPortfolioAnalysisScopeContext/);
    assert.match(source, /PortfolioAnalysisScopeTabs/);
    assert.match(
      source,
      /getReadOnlyTenantPortfolioStructureForScope\(\{[\s\S]*tenantContext: resolution\.tenantContext/,
    );
    assert.doesNotMatch(
      source,
      /getReadOnlyPortfolioStructure\(|fetch\(|\/api\/|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId/,
    );
  });

  it("keeps portfolio risk behind the resolved server tenant", () => {
    const pageSource = read("src/app/portfolio/risk/page.tsx");
    const querySource = read("src/db/queries/portfolio-risk.ts");
    const smokeSource = read("scripts/smoke-portfolio-risk-route.mjs");

    assert.match(pageSource, /resolveCurrentTenantContext\(\)/);
    assert.match(pageSource, /Promise\.all/);
    assert.match(pageSource, /if \(!resolution\.ok\)/);
    assert.match(pageSource, /PortfolioReadAccessBoundary/);
    assert.match(pageSource, /getReadOnlyTenantPortfolioAnalysisScopeContext/);
    assert.match(pageSource, /PortfolioAnalysisScopeBoundary/);
    assert.match(
      pageSource,
      /getReadOnlyTenantPortfolioRiskForScope\(\{[\s\S]*scope: selectedScope,[\s\S]*tenantContext: resolution\.tenantContext/,
    );
    assert.doesNotMatch(
      pageSource,
      /getReadOnlyPortfolioRisk\(|fetch\(|\/api\/|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId/,
    );

    assert.match(querySource, /^import "server-only";/);
    assert.match(querySource, /getReadOnlyTenantPortfolioRiskForScope/);
    assert.match(querySource, /getPortfolioAnalysisScopeTargets/);
    assert.match(
      querySource,
      /innerJoin\(accounts, eq\(assets\.accountId, accounts\.id\)\)/,
    );
    assert.match(
      querySource,
      /eq\(accounts\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(querySource, /eq\(accounts\.isActive, true\)/);
    assert.match(querySource, /inArray\(accounts\.code, TRACKED_ACCOUNTS\)/);
    assert.match(
      querySource,
      /eq\(assets\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(querySource, /eq\(assets\.account, accounts\.code\)/);
    const scopedRepositorySource = querySource.match(
      /export function createTenantPortfolioRiskScopeRepository[\s\S]*?(?=export async function getReadOnlyTenantPortfolioRiskForScope)/,
    )?.[0];
    assert.ok(scopedRepositorySource);
    assert.doesNotMatch(scopedRepositorySource, /TRACKED_ACCOUNTS/);
    assert.doesNotMatch(
      querySource,
      /export async function getReadOnlyPortfolioRisk|accountCondition\(/,
    );

    assert.match(smokeSource, /const SESSION_COOKIE/);
    assert.match(smokeSource, /if \(!SESSION_COOKIE\)/);
    assert.match(
      smokeSource,
      /status: "portfolio_risk_session_boundary_verified"/,
    );
    assert.match(smokeSource, /databaseReadAttempted: false/);
    assert.match(smokeSource, /signed-out risk shell must return 200/);
    assert.doesNotMatch(smokeSource, /no-auth risk request must return 401/);
    assert.match(
      smokeSource,
      /assert\.doesNotMatch\(boundary\.body, \/data-page=/,
    );
    assert.match(smokeSource, /if \(!sql\) throw new Error/);
  });

  it("authorizes every Investment Lab portfolio input through owned accounts", () => {
    const counterfactualSource = read("src/db/queries/investment-lab.ts");
    const scopeEvidenceSource = read(
      "src/db/queries/investment-lab-scope-evidence.ts",
    );
    const analysisScopesSource = read(
      "src/db/queries/portfolio-analysis-scopes.ts",
    );
    const availabilitySource = read(
      "src/db/queries/investment-lab-data-availability.ts",
    );
    const riskSource = read("src/db/queries/portfolio-risk.ts");
    const xraySource = read("src/db/queries/investment-lab-etf-xray.ts");

    for (const source of [counterfactualSource, availabilitySource, riskSource]) {
      assert.match(source, /^import "server-only";/);
      assert.match(
        source,
        /eq\(accounts\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId\)/,
      );
      assert.match(source, /eq\(accounts\.isActive,\s*true\)/);
      assert.match(source, /inArray\(accounts\.code,/);
      assert.doesNotMatch(
        source,
        /ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)/,
      );
    }

    for (const relation of [
      /innerJoin\(accounts, eq\(eventLedgerEntries\.accountId, accounts\.id\)\)/,
      /innerJoin\(accounts, eq\(dailyPortfolioSnapshots\.accountId, accounts\.id\)\)/,
      /innerJoin\(accounts, eq\(dailyPositionSnapshots\.accountId, accounts\.id\)\)/,
    ]) {
      assert.match(counterfactualSource, relation);
    }
    assert.match(
      counterfactualSource,
      /eq\(eventLedgerEntries\.account, accounts\.code\)/,
    );
    assert.match(
      counterfactualSource,
      /eq\(dailyPortfolioSnapshots\.account, accounts\.code\)/,
    );
    assert.match(
      counterfactualSource,
      /eq\(dailyPositionSnapshots\.account, accounts\.code\)/,
    );
    assert.doesNotMatch(
      counterfactualSource,
      /eq\((?:eventLedgerEntries|dailyPortfolioSnapshots|dailyPositionSnapshots)\.canonicalOwnerUserId/,
    );

    for (const relation of [
      /innerJoin\(accounts, eq\(assets\.accountId, accounts\.id\)\)/,
      /innerJoin\(accounts, eq\(dailyPortfolioSnapshots\.accountId, accounts\.id\)\)/,
      /innerJoin\(accounts, eq\(dailyPositionSnapshots\.accountId, accounts\.id\)\)/,
    ]) {
      assert.match(availabilitySource, relation);
    }
    assert.match(
      availabilitySource,
      /selectPreferredPrivateHistoricalPriceRows/,
    );
    assert.doesNotMatch(
      availabilitySource,
      /getReadOnlyTenantPortfolioRisk/,
    );
    assert.match(riskSource, /getReadOnlyTenantPortfolioRisk/);
    assert.match(
      riskSource,
      /innerJoin\(accounts, eq\(assets\.accountId, accounts\.id\)\)/,
    );
    assert.match(xraySource, /getReadOnlyTenantPortfolioStructure/);
    assert.doesNotMatch(xraySource, /getReadOnlyPortfolioStructure\(/);
    assert.match(scopeEvidenceSource, /^import "server-only";/);
    assert.match(
      scopeEvidenceSource,
      /eq\(accounts\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId\)/,
    );
    assert.match(
      analysisScopesSource,
      /eq\(\s*portfolioGroups\.canonicalOwnerUserId,\s*tenantContext\.ownerUserId/,
    );
    assert.match(
      scopeEvidenceSource,
      /portfolioGroupAccountMemberships\.canonicalOwnerUserId,[\s\S]*tenantContext\.ownerUserId/,
    );
    assert.match(
      scopeEvidenceSource,
      /portfolioGroupAssetMemberships\.canonicalOwnerUserId,[\s\S]*tenantContext\.ownerUserId/,
    );
    assert.match(
      scopeEvidenceSource,
      /innerJoin\(accounts, eq\(eventLedgerEntries\.accountId, accounts\.id\)\)/,
    );
    assert.match(
      scopeEvidenceSource,
      /dailyPositionSnapshots\.canonicalOwnerUserId,[\s\S]*tenantContext\.ownerUserId/,
    );
    assert.match(
      scopeEvidenceSource,
      /eq\(dailyPositionSnapshots\.isSample, false\)/,
    );
    assert.doesNotMatch(
      scopeEvidenceSource,
      /ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)|\bfetch\s*\(/,
    );
  });

  it("keeps Investment Lab behind one resolved server tenant", () => {
    const source = read("src/app/investment-lab/page.tsx");

    assert.match(source, /resolveCurrentTenantContext\(\)/);
    assert.match(source, /Promise\.all/);
    assert.match(source, /if \(!resolution\.ok\)/);
    assert.match(source, /PortfolioReadAccessBoundary/);
    for (const reader of [
      "getReadOnlyTenantInvestmentLabAnalysisScopeEvidence",
      "getReadOnlyTenantInvestmentLabCounterfactualForScope",
      "getReadOnlyTenantInvestmentLabDataAvailabilityForScope",
      "getReadOnlyTenantInvestmentLabEtfXrayFromPortfolio",
      "getReadOnlyTenantPortfolioStructureForScope",
    ]) {
      assert.match(source, new RegExp(reader));
    }
    assert.match(source, /data-page="investment-lab"/);
    assert.doesNotMatch(
      source,
      /getReadOnlyPortfolioStructure\(|\bfetch\s*\(|\/api\/|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId/,
    );
  });

  it("smokes the Investment Lab session boundary without product DB reads", () => {
    const source = read("scripts/smoke-investment-lab-route.mjs");

    assert.match(source, /const SESSION_COOKIE/);
    assert.match(source, /if \(!SESSION_COOKIE\)/);
    assert.match(source, /status: "session_boundary_verified"/);
    assert.match(source, /databaseReadAttempted: false/);
    assert.match(source, /assert\.doesNotMatch\(boundary\.body, \/data-page=/);
    assert.match(source, /if \(!sql\) throw new Error/);
    assert.match(source, /readArgument\("--scope"\)/);
    assert.match(source, /data-analysis-scope/);
    assert.doesNotMatch(source, /readArgument\("--account"\)/);
  });

  it("keeps Simulation shared research reads behind the resolved server session", () => {
    const pageSource = read("src/app/simulation/page.tsx");
    const smokeSource = read("scripts/smoke-simulation-route.mjs");

    assert.match(pageSource, /resolveCurrentTenantContext\(\)/);
    assert.match(pageSource, /Promise\.all/);
    assert.match(pageSource, /if \(!resolution\.ok\)/);
    assert.match(pageSource, /PortfolioReadAccessBoundary/);
    assert.ok(
      pageSource.indexOf("if (!resolution.ok)") <
        pageSource.indexOf("const modelPromise"),
      "shared simulation evidence must not be read before session resolution",
    );
    assert.doesNotMatch(
      pageSource,
      /\bfetch\s*\(|\/api\/|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId/,
    );

    assert.match(smokeSource, /const SESSION_COOKIE/);
    assert.match(smokeSource, /if \(!SESSION_COOKIE\)/);
    assert.match(
      smokeSource,
      /status: "simulation_session_boundary_verified"/,
    );
    assert.match(smokeSource, /databaseReadAttempted: false/);
    assert.match(
      smokeSource,
      /signedOutSimulation\.status,[\s\S]*200/,
    );
    assert.doesNotMatch(
      smokeSource,
      /no-auth simulation must return 401/,
    );
    assert.match(
      smokeSource,
      /data-page="simulation-input-readiness"/,
    );
    assert.match(smokeSource, /if \(!sql\) throw new Error/);
  });

  it("smokes the unauthenticated history boundary without direct database reads", () => {
    const source = read("scripts/smoke-history-route.mjs");

    assert.match(source, /const SESSION_COOKIE/);
    assert.match(source, /history_session_boundary/);
    assert.match(source, /productDataRead: "not_attempted"/);
    assert.match(source, /historyBoundary\.status, 200/);
    assert.match(source, /if \(!SESSION_COOKIE\)/);
    assert.match(source, /data-page="history"/);
    assert.doesNotMatch(source, /no-auth history request must return 401/);
    assert.doesNotMatch(
      source,
      /@neondatabase|DATABASE_URL|neon\(|sql\.query|select\s+.+\s+from|insert\s+into|update\s+.+\s+set|delete\s+from/i,
    );
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
