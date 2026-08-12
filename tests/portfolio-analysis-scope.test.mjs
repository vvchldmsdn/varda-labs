import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPortfolioAnalysisScopeCatalog,
  buildPortfolioAnalysisScopeHref,
  resolvePortfolioAnalysisScope,
} from "../src/lib/portfolio-analysis-scope.ts";

const ACCOUNTS = Object.freeze([
  Object.freeze({
    id: "11111111-1111-4111-8111-111111111111",
    code: "brokerage",
    name: "한국투자증권",
    isActive: true,
    sortOrder: 20,
  }),
  Object.freeze({
    id: "22222222-2222-4222-8222-222222222222",
    code: "isa",
    name: "ISA 계좌",
    isActive: true,
    sortOrder: 10,
  }),
  Object.freeze({
    id: "33333333-3333-4333-8333-333333333333",
    code: "closed-account",
    name: "해지 계좌",
    isActive: false,
    sortOrder: 30,
  }),
]);

const PORTFOLIO_GROUPS = Object.freeze([
  Object.freeze({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "은퇴 준비",
    isActive: true,
    sortOrder: 20,
  }),
  Object.freeze({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "장기 성장",
    isActive: true,
    sortOrder: 10,
  }),
  Object.freeze({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "보관된 그룹",
    isActive: false,
    sortOrder: 30,
  }),
]);

function readyCatalog() {
  const result = buildPortfolioAnalysisScopeCatalog({
    accounts: ACCOUNTS,
    portfolioGroups: PORTFOLIO_GROUPS,
  });
  assert.equal(result.state, "ready");
  return result;
}

describe("portfolio analysis scope", () => {
  it("builds dynamic portfolio groups before optional direct-account scopes", () => {
    const catalog = readyCatalog();

    assert.deepEqual(
      catalog.scopes.map(({ key, label }) => ({ key, label })),
      [
        { key: "all", label: "전체" },
        {
          key: "portfolio:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          label: "장기 성장",
        },
        {
          key: "portfolio:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          label: "은퇴 준비",
        },
        {
          key: "account:22222222-2222-4222-8222-222222222222",
          label: "ISA 계좌",
        },
        {
          key: "account:11111111-1111-4111-8111-111111111111",
          label: "한국투자증권",
        },
      ],
    );
  });

  it("resolves canonical UUID scopes and defaults to the virtual all scope", () => {
    const catalog = readyCatalog();

    assert.deepEqual(resolvePortfolioAnalysisScope({ catalog }), {
      state: "resolved",
      source: "default_all",
      scope: { kind: "all", key: "all", label: "전체" },
    });
    assert.deepEqual(
      resolvePortfolioAnalysisScope({
        catalog,
        scope: "portfolio:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
      {
        state: "resolved",
        source: "canonical",
        scope: {
          kind: "portfolio_group",
          key: "portfolio:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          label: "은퇴 준비",
          portfolioGroupId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
      },
    );
  });

  it("maps legacy account codes only through the owner-scoped catalog", () => {
    const result = resolvePortfolioAnalysisScope({
      account: "ISA",
      catalog: readyCatalog(),
    });

    assert.deepEqual(result, {
      state: "resolved",
      source: "legacy_compatibility",
      scope: {
        kind: "account",
        key: "account:22222222-2222-4222-8222-222222222222",
        label: "ISA 계좌",
        accountId: "22222222-2222-4222-8222-222222222222",
        accountCode: "isa",
      },
    });
  });

  it("blocks unknown, inactive, malformed, and ambiguous scopes without fallback", () => {
    const catalog = readyCatalog();

    assert.deepEqual(
      resolvePortfolioAnalysisScope({
        catalog,
        scope: "portfolio:dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
      { state: "blocked", reason: "scope_not_found" },
    );
    assert.deepEqual(
      resolvePortfolioAnalysisScope({
        catalog,
        scope: "portfolio:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
      { state: "blocked", reason: "scope_not_found" },
    );
    assert.deepEqual(
      resolvePortfolioAnalysisScope({ catalog, scope: "isa" }),
      { state: "blocked", reason: "invalid_scope_format" },
    );
    assert.deepEqual(
      resolvePortfolioAnalysisScope({
        account: "isa",
        catalog,
        scope: "all",
      }),
      { state: "blocked", reason: "conflicting_scope_parameters" },
    );
    assert.deepEqual(
      resolvePortfolioAnalysisScope({ catalog, scope: ["all", "all"] }),
      { state: "blocked", reason: "multiple_scope_values" },
    );
  });

  it("rejects malformed and duplicate owner-scoped catalog rows", () => {
    assert.deepEqual(
      buildPortfolioAnalysisScopeCatalog({
        accounts: [...ACCOUNTS, { ...ACCOUNTS[0], name: "중복" }],
        portfolioGroups: PORTFOLIO_GROUPS,
      }),
      { state: "integrity_error", reason: "duplicate_account_id" },
    );
    assert.deepEqual(
      buildPortfolioAnalysisScopeCatalog({
        accounts: [ACCOUNTS[0], { ...ACCOUNTS[1], code: "BROKERAGE" }],
        portfolioGroups: PORTFOLIO_GROUPS,
      }),
      { state: "integrity_error", reason: "duplicate_account_code" },
    );
    assert.deepEqual(
      buildPortfolioAnalysisScopeCatalog({
        accounts: ACCOUNTS,
        portfolioGroups: [
          PORTFOLIO_GROUPS[0],
          { ...PORTFOLIO_GROUPS[1], id: PORTFOLIO_GROUPS[0].id },
        ],
      }),
      {
        state: "integrity_error",
        reason: "duplicate_portfolio_group_id",
      },
    );
  });

  it("writes only the canonical scope parameter and preserves unrelated filters", () => {
    const href = buildPortfolioAnalysisScopeHref(
      "/simulation",
      "portfolio:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      {
        account: "isa",
        end: "2026-08-12",
        horizon: ["63", "126"],
        scope: "all",
      },
    );
    const url = new URL(href, "https://example.test");

    assert.equal(
      url.searchParams.get("scope"),
      "portfolio:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    assert.equal(url.searchParams.has("account"), false);
    assert.equal(url.searchParams.get("end"), "2026-08-12");
    assert.deepEqual(url.searchParams.getAll("horizon"), ["63", "126"]);
  });
});
