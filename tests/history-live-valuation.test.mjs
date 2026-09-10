import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildHistoryLiveValuation } from "../src/lib/history-live-valuation.ts";
import { buildHistoryOverview } from "../src/lib/history-overview.ts";
import { historyPointsWithMetric } from "../src/lib/history-explorer.ts";
import { importWithPorts } from "./helpers/import-with-ports.mjs";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";

const now = new Date("2026-09-08T15:20:00Z");
const valued = { currentValueKrw: 1_442_000, quantity: 10, currentPrice: 103, priceEvidenceSource: "live_price_quote", priceSource: "kis", priceFetchedAt: "2026-09-08T15:19:30Z", priceAsOf: "2026-09-08T15:19:00Z" };
const structure = (rows = [valued], excludedHoldingCount = 0) => ({ holdingRows: rows, excludedHoldingCount });
const live = (input = structure()) => buildHistoryLiveValuation(input, now);
function row(snapshotDate, totalMarketValue, extra = {}) {
  return { snapshotDate, account: "brokerage", source: "varda_daily_snapshot_v1", rowKind: "stored", derivedFromAccounts: [], totalMarketValue,
    totalCost: 1_000_000, totalPnl: totalMarketValue - 1_000_000, totalReturnPct: (totalMarketValue / 1_000_000 - 1) * 100,
    investedAmount: 1_000_000, cashValue: null, enb: 2, avgCorrelation: 0.3, ...extra };
}

describe("ephemeral current valuation in History", () => {
  it("appends today's KST valuation before 07:00 without changing saved rows or inventing return/risk", () => {
    const rows = Object.freeze([Object.freeze(row("2026-09-07", 1_000_000)), Object.freeze(row("2026-09-08", 1_400_000))]);
    const original = structuredClone(rows);
    const model = buildHistoryOverview({ rows, liveValuation: live() });
    assert.deepEqual(rows, original);
    assert.deepEqual(model.points.map(point => point.date), ["2026-09-07", "2026-09-08", "2026-09-09"]);
    assert.equal(model.latestValueKrw, 1_442_000);
    const point = model.points.at(-1);
    assert.equal(point.rowKind, "live");
    assert.equal(point.source, "varda_current_valuation");
    assert.equal(point.movementKrw, 42_000);
    for (const field of ["totalReturnPct", "totalPnlKrw", "risk", "investedAmountKrw", "cashValueKrw"]) assert.equal(point[field], null);
    assert.deepEqual(historyPointsWithMetric(model.points, "return"), buildHistoryOverview({ rows }).points);
  });

  it("preserves an existing same-date recorded return and risk as a separate observation", () => {
    const rows = [row("2026-09-08", 1_000_000), row("2026-09-09", 1_400_000, { totalReturnPct: 14.2, enb: 3 })];
    const original = structuredClone(rows);
    const saved = buildHistoryOverview({ rows });
    const model = buildHistoryOverview({ rows, liveValuation: live() });
    assert.equal(model.pointCount, 2);
    assert.equal(model.points.at(-1).valueKrw, 1_442_000);
    assert.equal(model.points.at(-1).totalReturnPct, null);
    assert.equal(model.points.at(-1).risk, null);
    assert.deepEqual(historyPointsWithMetric(model.points, "return"), saved.points);
    assert.equal(historyPointsWithMetric(model.points, "return").at(-1).totalReturnPct, 14.2);
    assert.equal(historyPointsWithMetric(model.points, "return").at(-1).risk.enb, 3);
    assert.deepEqual(rows, original);
    const onlyToday = buildHistoryOverview({ rows: [rows[1]], liveValuation: live() });
    assert.equal(historyPointsWithMetric(onlyToday.points, "return").length, 1);
  });

  it("labels stale or manual prices as recorded evidence while retaining the actual current valuation", () => {
    assert.equal(live().freshQuoteCount, 1);
    for (const change of [{ priceFetchedAt: "2026-09-08T15:14:59Z" }, { priceAsOf: "2026-09-07T15:19:00Z" }, { priceEvidenceSource: "asset_current_price_fallback" }, { priceFetchedAt: "2026-09-08T15:21:00Z" }]) {
      const result = live(structure([{ ...valued, ...change }]));
      assert.equal(result.state, "ready");
      assert.equal(result.valueKrw, 1_442_000);
      assert.equal(result.freshQuoteCount, 0);
      assert.equal(result.recordedPriceCount, 1);
    }
    assert.equal(live(structure([{ ...valued, priceAsOf: "2026-09-01T01:00:00Z" }])).oldestPriceAt, "2026-09-01T01:00:00Z");
  });

  it("does not append partial, missing, empty, invalid or overflowing valuations as zero", () => {
    const rows = [row("2026-09-08", 1_400_000)];
    const original = buildHistoryOverview({ rows });
    for (const input of [null, structure([], 0), structure([valued], 1), structure([{ ...valued, currentValueKrw: Number.NaN }]), structure([{ ...valued, currentPrice: 0 }]), structure([{ ...valued, currentValueKrw: Number.MAX_VALUE }, { ...valued, currentValueKrw: Number.MAX_VALUE }])]) {
      const current = live(input);
      assert.notEqual(current.state, "ready");
      assert.equal(current.valueKrw, null);
      assert.deepEqual(buildHistoryOverview({ rows, liveValuation: current }), original);
    }
    for (const current of [{ ...live(), date: "2026-09-08" }, { ...live(), capturedAt: "invalid" }, { ...live(), valueKrw: -1 }]) {
      assert.deepEqual(buildHistoryOverview({ rows, liveValuation: current }), original);
    }
    const futureRows = [row("2026-09-10", 1_500_000)];
    assert.deepEqual(buildHistoryOverview({ rows: futureRows, liveValuation: live() }), buildHistoryOverview({ rows: futureRows }));
  });

  it("reuses the authorized scope and Home's membership service date while displaying today's date", async () => {
    const tenantContext = Object.freeze({ ownerUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const scope = Object.freeze({ kind: "group", key: "group:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", groupId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "User group" });
    const calls = [];
    let fail = false;
    const [query] = await importWithPorts(["src/db/queries/history-live-valuation.ts"], {
      "@/db/queries/portfolio-structure": { getReadOnlyTenantPortfolioStructureForScope: async args => { calls.push(args); if (fail) throw new Error("read unavailable"); return structure(); } },
    });
    const result = await query.getReadOnlyTenantHistoryLiveValuation({ tenantContext, scope, now });
    assert.equal(calls[0].tenantContext, tenantContext);
    assert.equal(calls[0].scope, scope);
    assert.equal(calls[0].serviceDate, "2026-09-08");
    assert.equal(result.date, "2026-09-09");
    assert.equal(result.valueKrw, 1_442_000);
    fail = true;
    const unavailable = await query.getReadOnlyTenantHistoryLiveValuation({ tenantContext, scope, now });
    assert.equal(unavailable.state, "unavailable");
    assert.equal(unavailable.valueKrw, null);
  });

  it("server-renders the real current date and truthful live/recorded provenance in both locales", async () => {
    const [explorer, locale] = await importUiWithPorts(["src/components/history/history-time-explorer.tsx", "src/components/i18n/locale-provider.tsx"], {});
    for (const language of ["ko", "en"]) {
      for (const input of [structure(), structure([{ ...valued, priceEvidenceSource: "asset_current_price_fallback" }])]) {
        const model = buildHistoryOverview({ rows: [row("2026-09-08", 1_400_000)], liveValuation: live(input) });
        const html = renderToStaticMarkup(React.createElement(locale.LocaleProvider, { initialLocale: language }, React.createElement(explorer.HistoryTimeExplorer, { model, scopeLabel: "Actual scope name" })));
        assert.match(html, /data-history-live="true"/);
        assert.match(html, /2026[.\-]09[.\-]09/);
        assert.match(html, /00:20/);
        assert.doesNotMatch(html, /(?:AM|PM|오전|오후)\s*\d/);
        assert.match(html, /KST/);
        assert.match(html, /Actual scope name/);
        if (input.holdingRows[0].priceEvidenceSource === "live_price_quote") assert.match(html, language === "en" ? /Live valuation/ : /실시간 평가/);
        else assert.match(html, language === "en" ? /Includes recorded prices/ : /저장 가격 포함/);
        assert.doesNotMatch(html, /\[object Object\]/);
      }
    }
  });

  it("distinguishes insufficient one-point comparisons from true zero changes in both locales", async () => {
    const [explorer, locale] = await importUiWithPorts(["src/components/history/history-time-explorer.tsx", "src/components/i18n/locale-provider.tsx"], {
      "@/components/presentation/presentation-dialog": { PresentationDialog: ({ children }) => React.createElement("section", null, children) },
    });
    for (const initialLocale of ["ko", "en"]) {
      const markup = model => renderToStaticMarkup(React.createElement(locale.LocaleProvider, { initialLocale }, React.createElement(explorer.HistoryTimeExplorer, { model, scopeLabel: "Fixture" })));
      const metricValue = (html, label) => html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>([\\s\\S]*?)</dd>`))?.[1].replace(/<[^>]+>/g, "").trim();
      const metricDetail = (html, label) => html.match(new RegExp(`<dt[^>]*>${label}</dt><dd[^>]*>[\\s\\S]*?</dd><dd[^>]*>([\\s\\S]*?)</dd>`))?.[1].replace(/<[^>]+>/g, "").trim();
      const comparisonLabels = initialLocale === "ko"
        ? ["기간 평가액 변화", "기간 최대 낙폭", "최대 낙폭", "표시 범위 변화", "변화 금액", "변화율", "고점 대비"]
        : ["Period value change", "Period maximum drawdown", "Maximum drawdown", "Displayed period change", "Amount changed", "Percentage change", "Versus the peak"];
      const insufficient = initialLocale === "ko" ? "비교 기록 부족" : "Not enough records";
      const peakLabel = initialLocale === "ko" ? "고점 대비" : "Versus the peak";
      const liveOnly = markup(buildHistoryOverview({ rows: [], liveValuation: live() }));
      assert.match(liveOnly, initialLocale === "ko" ? /비교할 이전 저장 기록 없음/ : /No previous saved record to compare/);
      assert.doesNotMatch(liveOnly, /첫 저장점|First saved record/);
      const savedOnly = markup(buildHistoryOverview({ rows: [row("2026-09-08", 1_400_000)] }));
      assert.match(savedOnly, initialLocale === "ko" ? /첫 저장점/ : /First saved record/);
      assert.doesNotMatch(savedOnly, /비교할 이전 저장 기록 없음|No previous saved record to compare/);
      const sameDaySavedAndLive = markup(buildHistoryOverview({ rows: [row("2026-09-09", 1_400_000)], liveValuation: live() }));
      for (const html of [liveOnly, savedOnly, sameDaySavedAndLive]) {
        for (const label of comparisonLabels) assert.equal(metricValue(html, label), insufficient, label);
        assert.equal(metricDetail(html, peakLabel), insufficient);
        assert.match(metricValue(html, initialLocale === "ko" ? "관측점" : "Observations"), /^1/);
        assert.doesNotMatch(metricValue(html, initialLocale === "ko" ? "표시 범위 최고 평가액" : "Highest displayed value"), /기록|records/);
      }
      const flat = markup(buildHistoryOverview({ rows: [row("2026-09-07", 1_400_000), row("2026-09-08", 1_400_000)] }));
      assert.doesNotMatch(flat, /비교 기록 부족|Not enough records/);
      for (const label of comparisonLabels) assert.match(metricValue(flat, label), /0/, label);
      assert.equal(metricDetail(flat, peakLabel), "0%");

      // The default 90-day view has one point, but the point's real earlier peak
      // remains valid even when that observation is outside the selected range.
      for (const later of [
        { rows: [row("2026-01-01", 2_000_000), row("2026-09-08", 1_400_000)] },
        { rows: [row("2026-01-01", 2_000_000)], liveValuation: live() },
      ]) {
        const model = buildHistoryOverview(later);
        const original = structuredClone(model);
        const html = markup(model);
        assert.equal(metricValue(html, comparisonLabels[0]), insufficient);
        assert.match(metricValue(html, initialLocale === "ko" ? "관측점" : "Observations"), /^1/);
        assert.match(metricValue(html, peakLabel), /(?:-|−)/);
        assert.match(metricDetail(html, peakLabel), /(?:-|−).*%/);
        assert.deepEqual(model, original);
      }
    }
  });
});
