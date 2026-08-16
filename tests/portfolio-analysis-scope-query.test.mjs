import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const querySource = readFileSync(
  new URL("../src/db/queries/portfolio-analysis-scopes.ts", import.meta.url),
  "utf8",
);
const tabsSource = readFileSync(
  new URL("../src/components/portfolio-analysis-scope-tabs.tsx", import.meta.url),
  "utf8",
);
const groupReadSource = readFileSync(
  new URL("../src/db/queries/tenant-group-reads.ts", import.meta.url),
  "utf8",
);

describe("tenant portfolio analysis scope query", () => {
  it("builds the catalog only from active owner-scoped rows", () => {
    assert.match(querySource, /^import "server-only";/);
    assert.match(querySource, /Promise\.all\(/);
    assert.match(
      querySource,
      /eq\(accounts\.canonicalOwnerUserId, tenantContext\.ownerUserId\)/,
    );
    assert.match(querySource, /eq\(accounts\.isActive, true\)/);
    assert.match(querySource, /loadActiveTenantPortfolioGroups\(tenantContext\)/);
    assert.match(groupReadSource, /runTenantReadTransaction/);
    assert.match(groupReadSource, /where archived_at is null/);
    assert.match(querySource, /buildPortfolioAnalysisScopeCatalog/);
    assert.match(querySource, /resolvePortfolioAnalysisScope/);
    assert.doesNotMatch(
      querySource,
      /NAMED_PORTFOLIO_ACCOUNTS|headers\(\)|cookies\(\)|\.insert\(|\.update\(|\.delete\(/,
    );
  });

  it("keeps dynamic scope navigation server-rendered and URL-driven", () => {
    assert.match(tabsSource, /import Link from "next\/link"/);
    assert.match(tabsSource, /buildPortfolioAnalysisScopeHref/);
    assert.match(tabsSource, /scope\.kind === "portfolio_group"/);
    assert.doesNotMatch(tabsSource, /"use client"|useState|useEffect|fetch\(/);
  });
});
