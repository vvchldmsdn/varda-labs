import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

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

  it("renders localized scope links from the server catalog while keeping scope state in canonical URLs", async () => {
    assert.match(tabsSource, /import Link from "next\/link"/);
    assert.match(tabsSource, /buildPortfolioAnalysisScopeHref/);
    assert.match(tabsSource, /scope\.kind === "portfolio_group"/);
    // Locale is client state; scope ownership/catalog reads remain in the server-only query.
    assert.match(querySource, /^import "server-only";/);
    assert.doesNotMatch(tabsSource, /useState|useEffect|fetch\(|from\s+["'][^"']*(?:@\/db\/|drizzle-orm)|resolveCurrentTenantContext/);

    const accountId = "11111111-1111-4111-8111-111111111111";
    const groupId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const selectedScopeKey = `portfolio:${groupId}`;
    const scopes = Object.freeze([
      Object.freeze({ kind: "all", key: "all", label: "전체" }),
      Object.freeze({ kind: "account", key: `account:${accountId}`, accountId, accountCode: "isa", label: "홈" }),
      Object.freeze({ kind: "portfolio_group", key: selectedScopeKey, portfolioGroupId: groupId, label: "장기 투자" }),
    ]);
    const query = Object.freeze({ account: "isa", scope: "all", end: "2026-08-12", horizon: Object.freeze(["63", "126"]) });
    const before = structuredClone({ scopes, query });
    let links = [];
    const [tabs, provider] = await importUiWithPorts([
      "src/components/portfolio-analysis-scope-tabs.tsx",
      "src/components/i18n/locale-provider.tsx",
    ], {
      "next/link": { default: ({ href, children, ...props }) => {
        links.push({ href, label: children, current: props["aria-current"], accessibleName: props["aria-label"] });
        return React.createElement("a", { href, ...props }, children);
      } },
      "next/navigation": { usePathname: () => "/simulation" },
    });
    const localizedLinks = [];
    for (const locale of ["ko", "en"]) {
      links = [];
      const markup = renderToStaticMarkup(React.createElement(provider.LocaleProvider, { initialLocale: locale },
        React.createElement(tabs.PortfolioAnalysisScopeTabs, { basePath: "/simulation", query, scopes, selectedScopeKey }),
      ));
      assert.equal((markup.match(/<a\b/g) ?? []).length, scopes.length);
      assert.match(markup, /data-scope-rail="true"/);
      assert.equal(links.filter(link => link.current === "page").length, 1);
      assert.equal(links[2].current, "page");
      assert.equal(links[0].label, locale === "en" ? "All" : "전체");
      assert.equal(links[1].label, "홈", "user-defined names must not use the product-label translation");
      assert.equal(links[2].label, "장기 투자");
      for (const [index, link] of links.entries()) {
        const url = new URL(link.href, "https://example.test");
        assert.equal(url.pathname, "/simulation");
        assert.deepEqual(url.searchParams.getAll("scope"), [scopes[index].key]);
        assert.equal(url.searchParams.has("account"), false);
        assert.equal(url.searchParams.get("end"), "2026-08-12");
        assert.deepEqual(url.searchParams.getAll("horizon"), ["63", "126"]);
      }
      localizedLinks.push(links.map(link => link.href));
    }
    assert.deepEqual(localizedLinks[0], localizedLinks[1], "language must not change financial scope or filters");
    assert.deepEqual({ scopes, query }, before);
  });
});
