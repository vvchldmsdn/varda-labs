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
    assert.doesNotMatch(
      source,
      /"use client"|providerSubject|canonicalOwnerUserId|tenantContext\.ownerUserId|legacyBase44Id/,
    );
  });
});

function read(path) {
  return readFileSync(path, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
