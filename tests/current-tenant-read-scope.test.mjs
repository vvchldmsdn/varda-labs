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
    assert.match(source, /inArray\(accounts\.code,\s*NAMED_PORTFOLIO_ACCOUNTS\)/);
    assert.match(source, /eq\(assets\.account,\s*accounts\.code\)/);
    assert.doesNotMatch(
      source,
      /eq\(assets\.canonicalOwnerUserId|ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)/,
    );
  });

  it("keeps the holdings canary server-rendered and identity-minimal", () => {
    const source = read("src/app/portfolio/holdings/page.tsx");

    assert.match(source, /resolveCurrentTenantContext\(\)/);
    assert.match(source, /getReadOnlyTenantHoldings/);
    assert.match(source, /normalizePortfolioAccountScope/);
    assert.match(source, /Promise\.all/);
    assert.match(source, /holdingReadEvidence\(result, resolution\)/);
    assert.match(source, /result\.state === "partial"/);
    assert.match(source, /must not be used for valuation totals/);
    assert.doesNotMatch(
      source,
      /"use client"|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId|legacyBase44Id/,
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

    assert.match(pageSource, /resolveCurrentTenantContext\(\)/);
    assert.match(pageSource, /getReadOnlyTenantHistoryBalance/);
    assert.match(pageSource, /getReadOnlyTenantEvents/);
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
    assert.match(querySource, /inArray\(accounts\.code, NAMED_PORTFOLIO_ACCOUNTS\)/);
    assert.doesNotMatch(querySource, /ownerUserId\s*:\s*string|headers\(\)|cookies\(\)/);
  });

  it("authorizes dashboard-owned rows through active named accounts", () => {
    const source = read("src/db/queries/portfolio-dashboard.ts");

    assert.match(source, /^import "server-only";/);
    assert.match(
      source,
      /eq\(accounts\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(source, /eq\(accounts\.isActive, true\)/);
    assert.match(source, /inArray\(accounts\.code, NAMED_PORTFOLIO_ACCOUNTS\)/);
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
      /eq\((?:assets|eventLedgerEntries|dailyPositionSnapshots|dailyPortfolioSnapshots)\.canonicalOwnerUserId/,
    );
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
      assert.match(
        source,
        /getPortfolioDashboard\(\{[\s\S]*tenantContext: resolution\.tenantContext/,
      );
      assert.doesNotMatch(source, /fetch\(|\/api\//);
    }
  });

  it("authorizes portfolio structure through owned accounts and owner-scoped groups", () => {
    const source = read("src/db/queries/portfolio-structure.ts");

    assert.match(source, /^import "server-only";/);
    assert.match(source, /getReadOnlyTenantPortfolioStructure/);
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
      /eq\(assets\.canonicalOwnerUserId|ownerUserId\s*:\s*string|searchParams|headers\(\)|cookies\(\)/,
    );
  });

  it("keeps portfolio structure behind the resolved server session", () => {
    const source = read("src/app/portfolio/structure/page.tsx");

    assert.match(source, /resolveCurrentTenantContext\(\)/);
    assert.match(source, /Promise\.all/);
    assert.match(source, /if \(!resolution\.ok\)/);
    assert.match(source, /PortfolioReadAccessBoundary/);
    assert.match(
      source,
      /getReadOnlyTenantPortfolioStructure\(\{[\s\S]*tenantContext: resolution\.tenantContext/,
    );
    assert.doesNotMatch(
      source,
      /getReadOnlyPortfolioStructure\(|fetch\(|\/api\/|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId/,
    );
  });

  it("smokes the unauthenticated history boundary without direct database reads", () => {
    const source = read("scripts/smoke-history-route.mjs");

    assert.match(source, /history_session_boundary/);
    assert.match(source, /productDataRead: "not_attempted"/);
    assert.match(source, /unauthorizedHistory\.status,[\s\S]*401/);
    assert.match(source, /history\.status, 200/);
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
