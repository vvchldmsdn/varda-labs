import assert from "node:assert/strict";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const asOf = "2026-09-15T01:00:00.000Z";
const scope = { kind: "all", key: "all", label: "All" };
const dates = Array.from({ length: 36 }, (_, i) => new Date(Date.parse("2026-09-13T00:00:00Z") - (35 - i) * 86400000).toISOString().slice(0, 10));
const axis = dates.map(date => new Date(Date.parse(`${date}T00:00:00Z`) + 22 * 3600000).toISOString());
const position = (id, currency, kind = "holding") => ({ id, ownerId: owner, accountId: "owned-account", name: id, market: currency === "USD" ? "us" : "korea", ticker: id === "kr" ? "069500" : "VOO", kind,
  observation: { quantity: kind === "cash" ? "500" : "2", price: kind === "cash" ? "1" : "100", currency, at: asOf, priceObservedAt: asOf, source: "test_observed_native", basis: "raw" }, cost: null });
const rate = (at, value = "1300", kind = "daily_reference") => ({ base: "USD", quote: "KRW", rate: value, observedAt: at, fetchedAt: asOf, source: "test_dated_fx", kind });
function evidence(rows, reporting = "USD") {
  return { ownerId: owner, reporting, asOf, current: { at: asOf, source: "owned_test_ledger", scopeComplete: true, positions: rows }, history: [], trades: [],
    fx: [rate(asOf)], maxFxAgeMs: 3 * 86400000, maxPriceAgeMs: 10 * 86400000, ledgerComplete: true, cashFlows: [] };
}
function providerHistory(extra = {}) {
  return { status: "admitted", refreshDue: false, corporateActionCoverage: "complete", analysisEligible: true, fx: [], corporateActions: [],
    prices: dates.map((date, i) => ({ instrumentKey: "us:ARCX:VOO", ticker: "VOO", micCode: "ARCX", exchange: "NYSE Arca", value: String(100 + i), currency: "USD", observedAt: null, exchangeDate: date, fetchedAt: asOf, source: "twelve_data", basis: "raw", session: "regular" })), ...extra };
}
async function fixture({ rows = [position("us", "USD"), position("cash-usd", "USD", "cash")], provider = providerHistory(), resolveStatus = "resolved", historicalFx = true } = {}) {
  const pg = new PGlite();
  await pg.exec(`create table asset_price_snapshots("date" date,ticker text,market text,currency text,close_price numeric,source text,provider_symbol text,provider_exchange text,fetched_at timestamptz,is_sample boolean default false);
    create table fx_rates("date" date,usdkrw numeric,observed_at timestamptz,fetched_at timestamptz,source text,rate_kind text,status text,is_sample boolean default false);`);
  const calls = [];
  let owned = evidence(rows);
  const [identity] = await importWithPorts(["src/lib/market-data/twelve-data-identity.ts"], {});
  const [query, engine, normalizer] = await importWithPorts(["src/db/queries/currency-research.ts", "src/lib/currency-research.ts", "src/lib/native-research-history.ts"], {
    "@/db/client": { db: drizzle(pg) },
    "./portfolio-drafts": { listPortfolioDrafts: async () => [] },
    "./currency-tracked-portfolio": { getTrackedCurrencyEvidence: async (tenant, selected, reporting) => { assert.equal(tenant.ownerUserId, owner); assert.deepEqual(selected, scope); calls.push("owner"); return { ...owned, reporting }; } },
    "@/lib/market-data/twelve-data-service": {
      getTwelveDataServerConfig: () => ({ provider: { audience: "member_display" } }),
      getTwelveDataCompletedHistoryWindow: identity.getTwelveDataCompletedHistoryWindow,
      resolveTwelveDataTarget: input => { calls.push({ resolve: input }); return resolveStatus === "resolved" ? { status: "resolved", target: { ...input, key: "us:ARCX:VOO", authority: "explicit_instrument", accounts: [], assetIds: [], assetNames: [] } } : { status: resolveStatus }; },
      requestTwelveDataEvidence: async request => { calls.push(request); if (provider instanceof Error) throw provider; return { ...provider, prices: provider.prices.filter(row => row.exchangeDate >= request.startDate && row.exchangeDate <= request.endDate) }; },
      requestTwelveDataHistoricalFx: async request => { calls.push({ historicalFx: request }); return { status: historicalFx ? "admitted" : "missing", missingAt: historicalFx ? [] : request.requestedAt,
        fx: historicalFx ? request.requestedAt.map((at, index) => ({ baseCurrency: "USD", quoteCurrency: "KRW", rate: String(1400 - index), observedAt: at, requestedAt: at, fetchedAt: asOf, source: "twelve_data", kind: "historical_spot" })) : [] }; },
    },
  });
  async function seedPrices({ ticker = "069500", market = "korea", currency = "KRW", source = "kis", sample = false, fetchedAt = asOf } = {}) {
    for (const [index, date] of dates.entries()) await pg.query("insert into asset_price_snapshots values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [date, ticker, market, currency, 100 + index, source, ticker, market === "korea" ? "KRX" : "ARCX", fetchedAt, sample]);
  }
  return { pg, query, engine, normalizer, calls, seedPrices, identity, setEvidence(value) { owned = value; } };
}

it("loads actual native holdings and cash into the same currency engine and keeps owner ordering", async () => {
  const f = await fixture();
  try {
    const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "USD", { horizon: 30 });
    assert.equal(f.calls[0], "owner");
    assert.equal(input.provenance, "owned_native_history");
    assert.deepEqual(input.input.rows.map(row => [row.instrumentId, row.value, row.inputCurrency]), [["us", 200, "USD"], ["cash-usd", 500, "USD"]]);
    const providerRequest = f.calls.find(call => call?.kind === "history");
    assert.equal(providerRequest.target.key, "us:ARCX:VOO");
    assert.equal(providerRequest.endDate, "2026-09-13", "uses completed New York dates during Korean morning");
    const result = await f.engine.buildCurrencyResearch(input);
    assert.equal(result.status, "ready"); assert.equal(result.composition.total, 700);
    assert.equal(result.simulation.horizon, 30); assert.equal(result.simulation.paths.length, 1000);
    assert.equal(input.actualPortfolio.totalReturnPct, null, "a ready backcast must not become actual personal performance");
  } finally { await f.pg.close(); }
});

it("reuses the scoped current valuation for native Structure risk without another owner valuation read", async () => {
  const f = await fixture();
  try {
    const valuationEvidence = evidence([position("us", "USD"), position("cash-usd", "USD", "cash")]);
    const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "USD", { valuationEvidence, calculation: "risk_only" });
    assert.equal(f.calls.includes("owner"), false);
    assert.equal(input.input.asOf, valuationEvidence.asOf);
    assert.equal(input.calculation, "risk_only");
    const result = await f.engine.buildCurrencyResearch(input);
    assert.equal(result.status, "ready"); assert.ok(result.risk);
    assert.equal(result.lab, null); assert.equal(result.simulation, null);
    assert.equal(result.risk.sharpe, null); assert.equal(result.risk.beta, null);
    await assert.rejects(f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "KRW", { valuationEvidence }), /reporting_mismatch/);
  } finally { await f.pg.close(); }
});

it("reads exact owned KRW KIS rows from PGlite without inventing corporate-action coverage", async () => {
  const f = await fixture({ rows: [position("kr", "KRW")] });
  try {
    await f.seedPrices();
    await f.seedPrices({ ticker: "069500", market: "us", currency: "USD" });
    await f.seedPrices({ sample: true });
    const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "KRW");
    assert.equal(input.histories[0].points.length, dates.length);
    assert.ok(input.histories[0].points.every(point => point.currency === "KRW" && point.basis === "raw_price" && point.dataset.includes("KRX")));
    assert.equal(input.histories[0].corporateActions.status, "unknown");
    const result = await f.engine.buildCurrencyResearch(input);
    assert.equal(result.status, "incomplete");
    assert.ok(result.issues.some(issue => issue.code === "corporate_action_evidence_missing"));
    assert.equal(f.calls.some(call => call?.kind === "history"), false);
  } finally { await f.pg.close(); }
});

it("preserves an explicit historical end and horizon without backdating the current owned weights", async () => {
  const f = await fixture();
  try {
    const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "USD", { horizon: 63, endServiceDate: "2026-09-12" });
    assert.equal(input.input.asOf, asOf);
    assert.equal(input.historyEndAt, "2026-09-11T22:00:00.000Z");
    assert.equal(input.histories[0].points.at(-1).at, input.historyEndAt);
    assert.equal(f.calls.find(call => call?.kind === "history").endDate, "2026-09-11");
    const result = await f.engine.buildCurrencyResearch(input);
    assert.equal(result.status, "ready"); assert.equal(result.simulation.horizon, 63);
    assert.equal(result.metadata.valuationAsOf, asOf);
    assert.equal(result.metadata.lastObservation, input.historyEndAt);
    assert.equal(await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "USD", { endServiceDate: "2026-09-16" }), null);
  } finally { await f.pg.close(); }
});

it("ends actual performance and same-flow evidence at the selected historical boundary", async () => {
  const f = await fixture();
  try {
    const instant = day => new Date(`2026-09-${String(day).padStart(2, "0")}T07:00:00+09:00`).toISOString();
    const currentRows = [position("us", "USD"), position("cash-usd", "USD", "cash")];
    currentRows[1].observation.quantity = "530";
    const native = evidence(currentRows);
    native.history = [[8, "500"], [10, "500"], [12, "510"], [14, "530"]].map(([day, cash]) => ({ at: instant(day), source: "owned_capture", scopeComplete: true,
      positions: currentRows.map(row => ({ ...row, observation: { ...row.observation, quantity: row.kind === "cash" ? cash : "2", at: instant(day), priceObservedAt: instant(day) } })) }));
    native.history[2].at = new Date(Date.parse(instant(12)) + 1000).toISOString();
    native.cashFlows = [11, 13].map((day, index) => ({ id: `deposit-${day}`, ownerId: owner, accountId: "owned-account", currency: "USD", delta: index ? "20" : "10", kind: "external", at: instant(day) }));
    f.setEvidence(native);
    const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "USD", { endServiceDate: "2026-09-12", horizon: 63 });
    assert.equal(input.input.asOf, asOf);
    assert.equal(input.actualPortfolio.to, native.history[2].at, "selected service day includes a delayed capture");
    assert.equal(input.actualPortfolio.from, instant(8));
    assert.equal(input.actualPortfolio.valuationCount, 3);
    assert.equal(input.actualPortfolio.totalReturnPct, 0);
    assert.equal(input.counterfactual.actualPath.at(-1).at, native.history[2].at);
    assert.deepEqual(input.counterfactual.externalFlows.map(row => row.id), ["deposit-11"]);
    assert.ok(input.counterfactual.actualPath.every(row => Date.parse(row.at) < Date.parse(instant(13))));
  } finally { await f.pg.close(); }
});

it("uses stored dated daily FX before requesting any additional historical observations", async () => {
  const f = await fixture();
  try {
    for (const [index, at] of axis.entries()) await f.pg.query("insert into fx_rates values($1,$2,$3,$4,'er-api-open','daily_reference','ok',false)", [at.slice(0, 10), 1400 - index, at, asOf]);
    const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "KRW");
    const result = await f.engine.buildCurrencyResearch(input);
    assert.equal(result.status, "ready");
    assert.equal(f.calls.some(call => call?.historicalFx), false);
    assert.ok(input.fx.some(row => row.source === "er-api-open"));
  } finally { await f.pg.close(); }
});

it("requests only missing dated FX and recomputes KRW returns rather than relabeling USD results", async () => {
  const f = await fixture();
  try {
    const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "KRW");
    const requested = f.calls.find(call => call?.historicalFx).historicalFx.requestedAt;
    assert.deepEqual(requested, axis);
    assert.ok(input.fx.some(row => row.kind === "historical_spot"));
    const krw = await f.engine.buildCurrencyResearch(input);
    const usd = await f.engine.buildCurrencyResearch({ ...input, reportingCurrency: "USD" });
    assert.equal(krw.status, "ready"); assert.equal(usd.status, "ready");
    assert.notEqual(krw.lab.currentReturnPct, usd.lab.currentReturnPct);
    assert.notEqual(krw.metadata.cacheIdentity, usd.metadata.cacheIdentity);
    assert.equal(krw.actualHistory, undefined);
  } finally { await f.pg.close(); }
});

it("keeps missing historical FX blocked and preserves KIS fallback on an unsupported listing or provider failure", async () => {
  for (const options of [{ historicalFx: false }, { resolveStatus: "unsupported" }, { provider: new Error("source_unavailable") }]) {
    const f = await fixture(options);
    try {
      await f.seedPrices({ ticker: "VOO", market: "us", currency: "USD" });
      const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "KRW");
      const result = await f.engine.buildCurrencyResearch(input);
      assert.equal(result.status, "incomplete");
      assert.equal(input.input.rows.length, 2, "never drop a holding or cash because a provider failed");
      if (options.resolveStatus || options.provider) assert.equal(input.histories[0].admission, "shared_kis_raw");
      else assert.ok(result.issues.some(issue => ["fx_missing", "future_evidence", "fx_stale"].includes(issue.code)));
    } finally { await f.pg.close(); }
  }
});

it("rejects a mixed owner before research reads and blocks incomplete current valuations", async () => {
  const f = await fixture();
  try {
    f.setEvidence({ ...evidence([position("us", "USD")]), ownerId: other });
    await assert.rejects(f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "USD"), /owner_mismatch/);
    assert.deepEqual(f.calls, ["owner"]);
    f.setEvidence(evidence([{ ...position("us", "USD"), observation: null }]));
    assert.equal(await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "USD"), null);
  } finally { await f.pg.close(); }
});

it("normalizes verified splits and refuses stale, mixed-identity or unverified provider bars", async () => {
  const f = await fixture();
  try {
    const data = providerHistory({ corporateActions: [{ type: "split", date: dates[18], fromFactor: "4", toFactor: "1", cashAmount: null, currency: null, source: "twelve_data", fetchedAt: asOf }] });
    data.prices = data.prices.map((row, index) => ({ ...row, value: index < 18 ? "400" : "100" }));
    const normalized = f.normalizer.normalizeNativeResearchHistory("us", data, asOf);
    assert.ok(normalized.points.every(point => point.price === "100"));
    assert.equal(normalized.corporateActions.status, "verified_split_adjusted");
    assert.equal(f.normalizer.normalizeNativeResearchHistory("us", { ...data, refreshDue: true }, asOf).points.length, 0);
    assert.equal(f.normalizer.normalizeNativeResearchHistory("us", { ...data, corporateActionCoverage: "unknown" }, asOf).points.length, 0);
    assert.equal(f.normalizer.normalizeNativeResearchHistory("us", { ...data, prices: [...data.prices, { ...data.prices[0], instrumentKey: "another-listing" }] }, asOf).points.length, 0);
    assert.equal(f.normalizer.normalizeNativeResearchHistory("us", { ...data, prices: data.prices.map(row => ({ ...row, fetchedAt: "2026-09-16T00:00:00Z" })) }, asOf).points.length, 0);
  } finally { await f.pg.close(); }
});

it("keeps real cash-flow-adjusted performance separate from a profitable current-weight backcast", async () => {
  const f = await fixture();
  try {
    const currentRows = [position("us", "USD"), position("cash-usd", "USD", "cash")];
    currentRows[1].observation.quantity = "600";
    const native = evidence(currentRows);
    native.history = [{ at: axis[0], source: "native_ledger_snapshot", scopeComplete: true,
      positions: currentRows.map(row => ({ ...row, observation: { ...row.observation, quantity: row.kind === "cash" ? "500" : "2", at: axis[0], priceObservedAt: axis[0] } })) }];
    native.cashFlows = [{ id: "actual-deposit", ownerId: owner, accountId: "owned-account", currency: "USD", delta: "100", kind: "external", at: axis[12] }];
    native.trades = [{ id: "actual-cash-leg", ownerId: owner, positionId: "cash-usd", quantityDelta: "100", price: "1", currency: "USD", at: axis[12], source: "native_ledger_cash" }];
    f.setEvidence(native);
    const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, scope, "USD");
    const hypothetical = await f.engine.buildCurrencyResearch(input);
    assert.equal(input.actualPortfolio.totalReturnPct, 0, "a recorded deposit is external capital, not profit");
    assert.equal(input.actualPortfolio.from, axis[0]);
    assert.equal(input.actualPortfolio.to, asOf);
    assert.equal(input.actualPortfolio.method, "modified_dietz_including_cash");
    assert.equal(input.actualPortfolio.boundary, "portfolio_including_cash");
    assert.ok(hypothetical.lab.currentReturnPct > 0, "the same actual owner may have a different hypothetical backcast");
  } finally { await f.pg.close(); }
});

it("preserves selected-group performance boundaries for holding-only groups and selected dates", async () => {
  const f = await fixture({ rows: [position("us", "USD")] });
  try {
    const row = position("us", "USD"); row.observation.quantity = "3";
    const native = evidence([row]);
    const start = "2026-09-07T22:00:00.000Z", selectedEnd = "2026-09-11T22:00:01.000Z";
    native.groupEvidence = { policy: "current_membership_whole_cash_direct_holdings", stableSince: start, reason: null };
    native.history = [[start, "2"], [selectedEnd, "2.5"]].map(([at, quantity]) => ({ at, source: "native_group_snapshot", scopeComplete: true,
      positions: [{ ...row, observation: { ...row.observation, quantity, at, priceObservedAt: at } }] }));
    // The selected group excludes account cash; purchases cross its boundary.
    native.cashFlows = ["2026-09-10T00:00:00.000Z", "2026-09-14T00:00:00.000Z"].map((at, index) => ({ id: `group-purchase-${index}`, ownerId: owner,
      accountId: "owned-account", currency: "USD", delta: "50", kind: "external", at }));
    const groupScope = { kind: "portfolio_group", key: "group:fixture", portfolioGroupId: "fixture", label: "Selected holdings" };
    for (const options of [{}, { endServiceDate: "2026-09-12" }]) {
      const input = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, groupScope, "USD", { valuationEvidence: native, ...options });
      assert.equal(input.actualPortfolio.method, "modified_dietz_selected_group");
      assert.equal(input.actualPortfolio.boundary, "selected_group");
      assert.equal(input.actualPortfolio.totalReturnPct, 0, "purchases are capital entering selected holdings, not investment gain");
      assert.equal(input.actualPortfolio.to, options.endServiceDate ? selectedEnd : asOf);
      assert.equal(input.counterfactual.externalFlows.length, options.endServiceDate ? 1 : 2);
      assert.deepEqual(input.input.rows.map(item => item.instrumentId), ["us"], "the metadata must not claim excluded account cash");
    }
    const blocked = await f.query.getOwnedCurrencyResearchInput({ ownerUserId: owner }, groupScope, "USD", {
      valuationEvidence: { ...native, ledgerComplete: false, groupEvidence: { ...native.groupEvidence, reason: "group_income_allocation_missing" } }, endServiceDate: "2026-09-12",
    });
    assert.equal(blocked.actualPortfolio.totalReturnPct, null); assert.equal(blocked.actualPortfolio.boundary, "selected_group");
    assert.equal(blocked.counterfactual.complete, false);
  } finally { await f.pg.close(); }
});
