import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { riskRecoveryKind } from "../src/lib/recovery-risk.ts";
import { buildHistoryOverview } from "../src/lib/history-overview.ts";
import { getFixtureView } from "../src/lib/cairn-v2/fixtures.ts";
import { importUiWithPorts } from "./helpers/import-ui-with-ports.mjs";
import { composePortfolioRiskReadModel } from "../src/lib/portfolio-risk-read-model.ts";
import { portfolioRiskReadModelFixture } from "./fixtures/portfolio-risk-read-model.mjs";

const risk = (input = {}) => ({
  inputHealth: { status: "ready", blockers: [], exclusions: [], ...input.inputHealth },
  provenance: { eligibleHoldingCount: 2, ...input.provenance },
  calculation: { calculationStatus: "complete", reason: null, ...input.calculation },
});
describe("risk recovery actions use admitted reasons without changing calculations", () => {
  it("distinguishes a real single-stock missing-price read from supported standalone risk", () => {
    const fixture = portfolioRiskReadModelFixture();
    fixture.assetRows = fixture.assetRows.slice(0, 1);
    fixture.priceRows = fixture.priceRows.filter(row => row.ticker === fixture.assetRows[0].ticker);
    const complete = composePortfolioRiskReadModel(fixture);
    assert.equal(complete.calculation.calculationStatus, "standalone_only");
    assert.equal(riskRecoveryKind(complete), null);
    fixture.priceRows = [];
    const missing = composePortfolioRiskReadModel(fixture);
    assert.equal(missing.provenance.eligibleHoldingCount, 1);
    assert.equal(missing.provenance.usableReturnObservations, 0);
    assert.equal(missing.calculation.calculationStatus, "invalid");
    assert.equal(riskRecoveryKind(missing), "market");
  });
  it("leaves complete and supported single-instrument results alone", () => {
    assert.equal(riskRecoveryKind(risk()), null);
    assert.equal(riskRecoveryKind(risk({ inputHealth: { status: "insufficient_instruments" }, provenance: { eligibleHoldingCount: 1 }, calculation: { calculationStatus: "standalone_only" } })), null);
  });
  it("routes missing price coverage to preparation rather than transactions or targets", () => {
    for (const status of ["partial", "insufficient_coverage"]) assert.equal(riskRecoveryKind(risk({ inputHealth: { status } })), "market");
    for (const reason of ["input_insufficient_coverage", "insufficient_observations"]) assert.equal(riskRecoveryKind(risk({ calculation: { calculationStatus: "unavailable", reason } })), "market");
  });
  it("does not treat duplicate evidence as missing prices", () => {
    for (const reason of ["duplicate_price_date", "duplicate_fx_date"]) assert.equal(riskRecoveryKind(risk({ inputHealth: { status: "blocked", blockers: [{ reason, dates: ["2026-10-01"] }] } })), "retry");
  });
  it("keeps holdings absence separate from invalid calculation evidence and does not mutate inputs", () => {
    assert.equal(riskRecoveryKind(risk({ provenance: { eligibleHoldingCount: 0 } })), "holdings");
    assert.equal(riskRecoveryKind(risk({ inputHealth: { exclusions: [{ reason: "missing_ticker" }] } })), "holdings");
    const invalid = risk({ provenance: { eligibleHoldingCount: 0 }, calculation: { calculationStatus: "invalid", reason: "invalid_input" } });
    const before = structuredClone(invalid);
    assert.equal(riskRecoveryKind(invalid), "retry");
    assert.deepEqual(invalid, before);
  });
});

let recoveryProps;
const noticePort = { RecoveryNotice: props => { recoveryProps = props; return React.createElement("aside", { "data-recovery-kind": props.kind }); } };
const [explorer, locale] = await importUiWithPorts(["src/components/history/history-time-explorer.tsx", "src/components/i18n/locale-provider.tsx"], {
  "@/components/recovery/recovery-notice": noticePort,
  "@/components/presentation/presentation-dialog": { PresentationDialog: () => null },
});
function row(date, value) {
  return { snapshotDate: date, account: "brokerage", source: "varda", rowKind: "stored", derivedFromAccounts: [], totalMarketValue: value,
    totalCost: 100, totalPnl: value - 100, totalReturnPct: value - 100, investedAmount: 100, cashValue: null };
}
function historyRender(model, props = {}) {
  recoveryProps = undefined;
  return renderToStaticMarkup(React.createElement(locale.LocaleProvider, { initialLocale: "ko" }, React.createElement(explorer.HistoryTimeExplorer, {
    model, scopeLabel: "Synthetic account", recovery: { scope: "account:owned", readFailed: true, valuationIncomplete: false }, ...props,
  })));
}
describe("history recovery preserves only real display selections", () => {
  const model = buildHistoryOverview({ rows: [row("2026-08-01", 100), row("2026-10-01", 110), row("2026-10-10", 120)] });
  it("carries the selected period, metric and observed date back to the same scope", () => {
    const html = historyRender(model, { initialSelection: { period: "ALL", metric: "return", date: "2026-08-01" } });
    assert.match(html, /data-recovery-kind="retry"/);
    assert.equal(recoveryProps.scope, "account:owned");
    assert.deepEqual(recoveryProps.draft, { metric: "return", period: "ALL", date: "2026-08-01" });
  });
  it("ignores dates outside the chosen period and duplicate or invalid selection hints", () => {
    historyRender(model, { initialSelection: { period: "30D", metric: "value", date: "2026-08-01" } });
    assert.equal(recoveryProps.draft.date, "2026-10-10");
    historyRender(model, { initialSelection: { period: ["ALL"], metric: ["return"], date: "not-a-date" } });
    assert.deepEqual(recoveryProps.draft, { metric: "value", period: "90D", date: "2026-10-10" });
  });
  it("offers saved-record review for first-day history, not fabricated performance or trade repair", () => {
    const html = historyRender(buildHistoryOverview({ rows: [] }), { recovery: { scope: "all", readFailed: false, valuationIncomplete: false } });
    assert.match(html, /data-recovery-kind="history"/);
    assert.doesNotMatch(html, /data-recovery-kind="trades"|data-recovery-kind="market"/);
    assert.deepEqual(recoveryProps.draft, { metric: "value", period: "90D" });
  });
  it("does not expose repair navigation in a design preview", () => {
    assert.doesNotMatch(historyRender(buildHistoryOverview({ rows: [] }), { recovery: undefined }), /data-recovery-kind/);
  });
});

let writable = true;
const preferences = { period: "ALL", metric: "value", historyDate: null, setHistoryDate() {}, setPeriod() {}, setMetric() {} };
const providerPort = {
  useBetaExistingCrudAvailable: () => writable,
  useBetaReadFreshness: () => undefined,
  useBetaPreferences: () => preferences,
};
const [betaHistory, { parseHistoryReturn, parseHistoryDisplayReturn, historyDisplayReturnHref, validateHistoryDisplayReturn, validateHistoryReturn }] = await importUiWithPorts(["src/components/cairn-v2/history-detail.tsx", "src/lib/cairn-v2/history-return.ts"], {
  "next/link": { default: ({ href, children }) => React.createElement("a", { href }, children) },
  "@/components/recovery/recovery-notice": noticePort,
  "@/components/cairn-v2/beta-provider": providerPort,
  "@/components/cairn-v2/beta-charts": { HistoryChart: () => null, historyRows: view => view.history },
  "@/lib/cairn-v2/read-display": { historySourceView: view => ({ view, options: [], selected: "observed" }) },
});
describe("beta history recovery keeps management and read boundaries", () => {
  const context = { mode: "domain", scope: "account:owned", currency: "KRW", fixture: "empty" };
  function render(state, { enabled = true, domain = true, rows = [] } = {}) {
    writable = enabled; recoveryProps = undefined;
    const view = { ...getFixtureView({ ...context, scope: "all" }), history: rows, domain: { state, historyState: state, historyReadStatus: state === "unavailable" ? "unavailable" : "ready", valueState: "unavailable" } };
    return renderToStaticMarkup(React.createElement(betaHistory.HistoryDetail, { context: domain ? context : { ...context, mode: undefined }, view }));
  }
  it("hides management actions for fixtures, loading, unauthorized and read-only empty views", () => {
    for (const state of ["loading", "unauthorized"]) assert.doesNotMatch(render(state), /data-recovery-kind/);
    assert.doesNotMatch(render("empty", { domain: false }), /data-recovery-kind/);
    assert.doesNotMatch(render("empty", { enabled: false }), /data-recovery-kind/);
    assert.match(render("unavailable", { enabled: false }), /data-recovery-kind="retry"/);
  });
  it("uses the existing validated history-return contract for an observed selection", () => {
    const rows = [{ date: "2026-10-01", valueKrw: 100, exampleReturnPct: null, source: "saved", rowKind: "stored" }];
    assert.match(render("ready", { rows }), /data-recovery-kind="history"/);
    const href = new URL(recoveryProps.returnHref, "https://example.invalid");
    assert.equal(href.pathname, "/beta/history");
    assert.deepEqual(parseHistoryReturn(href.searchParams, context), { date: "2026-10-01", period: "ALL", metric: "value", scope: "account:owned", currency: "KRW", kind: "origin" });
  });
  it("carries period and metric for an empty view without supplying a historical date", () => {
    render("empty");
    const href = new URL(recoveryProps.returnHref, "https://example.invalid");
    assert.equal(parseHistoryReturn(href.searchParams, context), null);
    assert.deepEqual(parseHistoryDisplayReturn(href.searchParams, context), { period: "ALL", metric: "value", scope: "account:owned", currency: "KRW" });
    assert.equal(href.searchParams.has("_historyDate"), false);
  });
  it("also treats a live value as display preferences, never as stored date evidence", () => {
    render("ready", { rows: [{ date: "2026-10-29", valueKrw: 120, exampleReturnPct: null, source: "current_investment_valuation", rowKind: "live" }] });
    const href = new URL(recoveryProps.returnHref, "https://example.invalid");
    assert.equal(parseHistoryReturn(href.searchParams, context), null);
    assert.equal(parseHistoryDisplayReturn(href.searchParams, context).period, "ALL");
  });
});

describe("date-free history continuation admission", () => {
  const context = { mode: "domain", scope: "account:owned", currency: "KRW", fixture: "standard" };
  const search = () => new URL(historyDisplayReturnHref(context, { period: "6M", metric: "return" }), "https://example.invalid").searchParams;
  const hint = parseHistoryDisplayReturn(search(), context);
  it("accepts empty authorized history without creating observations or dates", () => {
    const view = { history: [], domain: { state: "ready", historyState: "empty" } }, before = structuredClone(view);
    assert.equal(validateHistoryDisplayReturn(hint, view), "valid");
    assert.deepEqual(view, before);
    assert.equal("date" in hint, false);
  });
  it("waits for a fresh read and does not apply preferences through denied or failed reads", () => {
    assert.equal(validateHistoryDisplayReturn(hint, { domain: { state: "loading", historyState: "ready" } }), "loading");
    assert.equal(validateHistoryDisplayReturn(hint, { domain: { state: "ready", historyState: "loading" } }), "loading");
    assert.equal(validateHistoryDisplayReturn(hint, { domain: { state: "unauthorized", historyState: "ready" } }), "unavailable");
    assert.equal(validateHistoryDisplayReturn(hint, { domain: { state: "ready", historyState: "unavailable" } }), "unavailable");
  });
  it("rejects duplicate, cross-scope, cross-currency, fixture and mixed date hints", () => {
    for (const [key, value] of [["_historyViewPeriod", "1M"], ["_historyDate", "2026-10-01"], ["_historyDateBasis", "storage"]]) {
      const params = search(); params.append(key, value);
      assert.equal(parseHistoryDisplayReturn(params, context), "invalid");
    }
    for (const different of [{ ...context, scope: "account:other" }, { ...context, currency: "USD" }, { ...context, mode: undefined }]) assert.equal(parseHistoryDisplayReturn(search(), different), "invalid");
  });
  it("keeps the original stored-date validation strict", () => {
    const stored = { date: "2026-10-01", period: "ALL", metric: "value", scope: context.scope, currency: context.currency, kind: "origin" };
    assert.equal(validateHistoryReturn(stored, { history: [], domain: { state: "ready", historyState: "empty" } }), "unavailable");
    assert.equal(validateHistoryReturn(stored, { history: [{ date: "2026-10-02" }], domain: { historyState: "ready" } }), "missing");
    assert.equal(validateHistoryReturn(stored, { history: [{ date: "2026-10-01" }], domain: { historyState: "loading" } }), "loading");
    assert.equal(validateHistoryReturn(stored, { history: [{ date: "2026-10-01" }], domain: { historyState: "ready" } }), "valid");
  });
});
