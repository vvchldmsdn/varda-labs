import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const accountId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const scope = { kind: "account", key: `account:${accountId}`, label: "Fixture", accountId, accountCode: "brokerage" };
let currentQuery = new URLSearchParams();
const routingPorts = {
  "next/link": { default: ({ href, children, ...props }) => { delete props.prefetch; delete props.scroll; return React.createElement("a", { ...props, href }, children); } },
  "next/navigation": { useSearchParams: () => currentQuery, useRouter: () => ({ push() {}, replace() {} }), usePathname: () => "/history" },
  "@/components/portfolio-primary-navigation": { PortfolioPrimaryNavigation: () => React.createElement("nav", null, "Fixture navigation") },
  "@/components/portfolio-analysis-scope-tabs": { PortfolioAnalysisScopeTabs: () => null },
};
const [view, balance, position, comparison, detail, overview] = await importUiWithPorts([
  "src/components/history/history-view.tsx", "src/lib/history-balance.ts", "src/lib/history-position-detail.ts", "src/lib/history-position-comparison.ts", "src/components/history/history-detail-state.ts", "src/lib/history-overview.ts",
], routingPorts);

function fixture(count) {
  const dates = Array.from({ length: count }, (_, index) => new Date(Date.UTC(2023, 0, index + 1)).toISOString().slice(0, 10));
  const raw = dates.map((date, index) => ({ snapshotDate: date, account: "brokerage", source: "varda", cashValue: "0", investedAmount: "10000000", totalCost: "10000000", totalMarketValue: String(10000000 + index * 1000), totalPnl: String(index * 1000), totalReturnPct: String(index / 100), avgCorrelation: null, enb: null, portfolioVolatility: null, regimeLabel: null, regimeScore: null }));
  const portfolioRows = balance.buildPortfolioHistoryDisplayRows({ rows: raw, account: "brokerage", expectedAccounts: ["brokerage"] });
  const balanceRows = dates.map(date => ({ balanceDate: date, cash: "0", brokerage: "10000000", isa: "0", irp: "0" })).reverse();
  const positionDetail = position.buildHistoryPositionDetail({ account: "brokerage", lane: "all", selection: position.normalizeHistoryPositionSelection({ account: "brokerage", lane: "all" }), portfolioRows, positionRows: [] });
  const positionComparison = comparison.buildHistoryPositionComparison({ account: "brokerage", lane: "all", selection: comparison.normalizeHistoryPositionComparisonSelection({ account: "brokerage", lane: "all" }), portfolioRows, fromRows: [], toRows: [] });
  return { raw, dates, history: { analysisScopes: [scope], selectedScope: scope, balanceAccount: "brokerage", lane: "all", readStatus: "ready", unavailableSources: [], balanceRows, portfolioRows, positionDetail, positionComparison,
    summary: { balanceRowCount: count, portfolioRowCount: portfolioRows.length, derivedPortfolioRowCount: 0, partialPortfolioRowCount: 0, balanceDateRange: { minDate: dates[0], maxDate: dates.at(-1) }, portfolioDateRange: { minDate: dates[0], maxDate: dates.at(-1) }, overlappingDateCount: count } } };
}

function render(history, detailParams = {}, liveValuation) {
  currentQuery = new URLSearchParams({ scope: scope.key, ...detailParams });
  return renderToStaticMarkup(React.createElement(view.HistoryView, { history, events: null, eventsSupported: true, generatedAt: "2026-09-08T00:00:00Z", detailParams, liveValuation }));
}

describe("History demand-driven server evidence", () => {
  it("keeps record insights saved-only when a live point replaces today's snapshot or is the only value", () => {
    const { history } = fixture(2);
    const liveValuation = { state: "ready", date: "2023-01-02", capturedAt: "2023-01-02T00:00:00Z", valueKrw: 9_000_000, priceSources: ["kis"], freshQuoteCount: 1, recordedPriceCount: 0 };
    const savedMarkup = render(history, { detail: "records" });
    const mixedMarkup = render(history, { detail: "records" }, liveValuation);
    const insights = markup => markup.match(/<section[^>]*data-history-recorded-insights="saved"[^>]*>([\s\S]*?)<\/section>/)?.[1];
    assert.ok(insights(savedMarkup));
    assert.equal(insights(mixedMarkup), insights(savedMarkup));
    assert.match(mixedMarkup, /9,000,000/);
    const liveOnly = render(fixture(0).history, { detail: "records" }, liveValuation);
    assert.match(liveOnly, /아직 저장된 평가 기록이 없습니다/);
    assert.doesNotMatch(liveOnly, /data-history-recorded-insights|저장 저점|저장점 방향 기준/);
    assert.match(liveOnly, /9,000,000/);
  });

  it("does not build raw server children or render any hidden table for a 1000-day main page", () => {
    const { history } = fixture(1000);
    // Accessing raw data throws: a client-only visibility guard cannot satisfy this.
    const guarded = { ...history, get balanceRows() { throw new Error("raw evidence touched before request"); }, get summary() { throw new Error("raw summary touched before request"); } };
    const initial = render(guarded);
    assert.equal((initial.match(/<tr\b/g) ?? []).length, 0);
    assert.doesNotMatch(initial, /히스토리 원시 기록|스냅샷 저장일|잔액 기준일/);
    assert.match(initial, /90일/);
    assert.equal(overview.buildHistoryOverview({ rows: history.portfolioRows }).points.length, 1000);
    const records = render(guarded, { detail: "records" });
    assert.match(records, /원시 기록 검증/);
    assert.equal((records.match(/<tr\b/g) ?? []).length, 0);
  });

  it("renders only the requested raw page and reaches all rows without changing overview evidence", () => {
    const { history } = fixture(107);
    for (const [page, expectedRows] of [["1", 100], ["2", 100], ["3", 14]]) {
      const html = render(history, { detail: "raw", balancePage: page, portfolioPage: page });
      const bodies = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)];
      assert.equal(bodies.length, 2);
      assert.equal(bodies.reduce((sum, match) => sum + (match[1].match(/<tr\b/g) ?? []).length, 0), expectedRows);
      assert.match(html, /히스토리 원시 기록/);
      assert.match(html, /기록·이벤트로 돌아가기/);
      assert.match(html, /scope=account%3A/);
      assert.match(html, new RegExp(`portfolioPage=${page}`));
    }
    assert.equal(history.portfolioRows.length, 107);
    assert.equal(overview.buildHistoryOverview({ rows: history.portfolioRows }).points.length, 107);
    const collected = ["1", "2", "3"].flatMap(page => detail.historyEvidencePage(history.portfolioRows, page).rows);
    assert.deepEqual(collected, history.portfolioRows);
  });

  it("normalizes malformed pages, preserves scope and preview, and retains old deep links", () => {
    const rows = Array.from({ length: 107 }, (_, index) => index);
    for (const value of [undefined, "-2", "2.5", ["2", "3"], "Infinity", "999999999999999999999999999999"]) assert.equal(detail.historyEvidencePage(rows, value).page, 1);
    assert.equal(detail.historyEvidencePage(rows, "999").page, 3);
    assert.equal(detail.historyEvidencePage([], "3").start, 0);
    assert.equal(detail.normalizeHistoryDetail({ positionDate: "2023-01-01" }), "raw");
    assert.equal(detail.normalizeHistoryDetail({ detail: ["raw"] }), null);
    const url = detail.historyDetailHref("scope=account%3Afixture&lane=portfolio&preview=design&portfolioPage=2", { detail: "raw", balancePage: "3" });
    const params = new URL(url, "https://example.test").searchParams;
    assert.equal(params.get("scope"), "account:fixture");
    assert.equal(params.get("preview"), "design");
    assert.equal(params.get("portfolioPage"), "2");
  });

  it("defers balance and selected-position reads while keeping all owned portfolio dates", async () => {
    const { raw, history } = fixture(107);
    const reads = [];
    const [query] = await importWithPorts(["src/db/queries/history-balance.ts"], {
      "@/db/queries/tenant-group-reads": { loadTenantPortfolioGroupMemberships: async () => { throw new Error("unexpected group read"); } },
      "@/db/queries/tenant-history-snapshots": {
        loadTenantHistoryPortfolioRows: async args => { assert.equal(args.tenantContext.ownerUserId, owner); assert.deepEqual(args.accountIds, [accountId]); reads.push("portfolio"); return raw; },
        loadTenantHistoryPositionDetailRows: async args => { assert.equal(args.accountId, accountId); reads.push("position"); return []; },
        loadTenantHistoryPositionComparisonRows: async args => { assert.equal(args.accountId, accountId); reads.push("comparison"); return []; },
        loadTenantHistoryGroupPositionRows: async () => { throw new Error("unexpected group read"); },
      },
      "@/db/tenant-transaction-context": { runTenantReadTransaction: async (userId, factory) => { assert.equal(userId, owner); reads.push("balance"); return Promise.all(factory({ query: async () => history.balanceRows })); } },
    });
    const args = { analysisScopes: [scope], scope, tenantContext: { ownerUserId: owner }, lane: "all", positionSelection: position.normalizeHistoryPositionSelection({ account: "brokerage", lane: "all", positionDate: "2023-01-01", positionSource: "varda" }), positionComparisonSelection: comparison.normalizeHistoryPositionComparisonSelection({ account: "brokerage", lane: "all", comparisonFrom: "2023-01-01~varda", comparisonTo: "2023-01-02~varda" }) };
    const main = await query.getReadOnlyTenantHistoryBalance({ ...args, includeRawEvidence: false });
    assert.deepEqual(reads, ["portfolio"]);
    assert.equal(main.portfolioRows.length, 107);
    assert.equal(main.balanceRows.length, 0);
    assert.equal(main.readStatus, "ready");
    reads.length = 0;
    const requested = await query.getReadOnlyTenantHistoryBalance({ ...args, includeRawEvidence: true });
    assert.deepEqual(reads.sort(), ["balance", "comparison", "comparison", "portfolio", "position"]);
    assert.deepEqual(requested.portfolioRows, main.portfolioRows);
    assert.equal(requested.balanceRows.length, 107);

    // Legacy cash-only evidence never served as the main portfolio trajectory.
    raw.length = 0;
    const cashArgs = { ...args, scope: { ...scope, accountCode: "cash" }, positionSelection: position.normalizeHistoryPositionSelection({ account: "cash", lane: "all" }), positionComparisonSelection: comparison.normalizeHistoryPositionComparisonSelection({ account: "cash", lane: "all" }) };
    const cashMain = await query.getReadOnlyTenantHistoryBalance({ ...cashArgs, includeRawEvidence: false });
    const cashRaw = await query.getReadOnlyTenantHistoryBalance({ ...cashArgs, includeRawEvidence: true });
    assert.deepEqual(overview.buildHistoryOverview({ rows: cashMain.portfolioRows }), overview.buildHistoryOverview({ rows: cashRaw.portfolioRows }));
    assert.equal(cashRaw.balanceRows.length, 0); // Cash is not a legacy HistoryAccount scope.
    const legacyMain = await query.getReadOnlyTenantHistoryBalance({ ...args, includeRawEvidence: false });
    const legacyRaw = await query.getReadOnlyTenantHistoryBalance({ ...args, includeRawEvidence: true });
    assert.deepEqual(overview.buildHistoryOverview({ rows: legacyMain.portfolioRows }), overview.buildHistoryOverview({ rows: legacyRaw.portfolioRows }));
    assert.equal(legacyRaw.balanceRows.length, 107);
    assert.match(render(legacyRaw, { detail: "raw" }), /잔액 기준일/);
  });

  it("uses the existing dynamic page authentication and resolved scope before any requested raw read", async () => {
    const { history } = fixture(5);
    const reads = [];
    const liveReads = [];
    let localeCookieValue = "en";
    let resolution = { ok: false, reason: "unauthenticated" };
    let context = { state: "ready", resolution: { state: "resolved", scope }, catalog: { scopes: [scope] } };
    const [page] = await importUiWithPorts(["src/app/history/page.tsx"], {
      ...routingPorts,
      "next/headers": { cookies: async () => ({ get: name => {
        assert.equal(name, "varda-locale");
        return localeCookieValue === undefined ? undefined : { value: localeCookieValue };
      } }) },
      "@/components/secondary-page-header": { SecondaryPageHeader: () => null },
      "@/components/portfolio-analysis-scope-boundary": { PortfolioAnalysisScopeBoundary: () => null },
      "@/lib/auth/current-tenant-context": { resolveCurrentTenantContext: async () => resolution },
      "@/db/queries/portfolio-analysis-scopes": { getReadOnlyTenantPortfolioAnalysisScopeContext: async () => context },
      "@/db/queries/history-balance": { getReadOnlyTenantHistoryBalance: async args => { reads.push(args); return history; } },
      "@/db/queries/tenant-events": { getReadOnlyTenantEvents: async () => null },
      "@/db/queries/history-live-valuation": { getReadOnlyTenantHistoryLiveValuation: async args => { liveReads.push(args); return null; } },
    });
    assert.equal(page.dynamic, "force-dynamic");
    assert.equal((await page.generateMetadata()).title, "History | VARDA LABS");
    localeCookieValue = undefined;
    assert.equal((await page.generateMetadata()).title, "히스토리 | VARDA LABS");
    assert.equal(reads.length, 0, "localized metadata must not trigger a financial evidence read");
    assert.equal(liveReads.length, 0);
    await page.default({ searchParams: Promise.resolve({ detail: "raw", scope: scope.key }) });
    assert.equal(reads.length, 0);
    assert.equal(liveReads.length, 0);
    resolution = { ok: true, tenantContext: { ownerUserId: owner } };
    context = { state: "unavailable" };
    await page.default({ searchParams: Promise.resolve({ detail: "raw", scope: scope.key }) });
    assert.equal(reads.length, 0);
    assert.equal(liveReads.length, 0);
    context = { state: "ready", resolution: { state: "resolved", scope }, catalog: { scopes: [scope] } };
    for (const panel of [undefined, "records", "raw"]) {
      const result = await page.default({ searchParams: Promise.resolve({ detail: panel, scope: scope.key }) });
      assert.equal(reads.at(-1).includeRawEvidence, panel === "raw");
      assert.equal(reads.at(-1).tenantContext.ownerUserId, owner);
      assert.equal(reads.at(-1).scope.accountId, accountId);
      assert.equal(liveReads.at(-1).tenantContext.ownerUserId, owner);
      assert.equal(liveReads.at(-1).scope.accountId, accountId);
      assert.equal(result.props.detailParams.detail, panel);
    }
    assert.equal(liveReads.length, 3);
  });

  it("uses the real deferred History view in design preview and paginates its existing 122 points", async () => {
    const [preview] = await importUiWithPorts(["src/components/history/history-design-preview.tsx"], routingPorts);
    currentQuery = new URLSearchParams("preview=design&scope=all");
    const initial = preview.HistoryDesignPreview({ scope: "all" });
    assert.equal(initial.props.history.portfolioRows.length, 122);
    assert.equal(overview.buildHistoryOverview({ rows: initial.props.history.portfolioRows }).pointCount, 122);
    const initialHtml = renderToStaticMarkup(initial);
    assert.equal((initialHtml.match(/<tr\b/g) ?? []).length, 0);
    assert.doesNotMatch(initialHtml, /아직 탐색할 기록이 없습니다/);
    assert.match(initialHtml, /90일/);
    currentQuery.set("detail", "raw");
    currentQuery.set("portfolioPage", "3");
    const raw = preview.HistoryDesignPreview({ scope: "all", detailParams: { detail: "raw", portfolioPage: "3" } });
    const html = renderToStaticMarkup(raw);
    const body = html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? "";
    assert.equal((body.match(/<tr\b/g) ?? []).length, 22);
    assert.match(html, /preview=design/);
  });
});
