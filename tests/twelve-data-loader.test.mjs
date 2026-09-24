import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { importWithPorts } from "./helpers/import-with-ports.mjs";

const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", account = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const scope = { kind: "all", key: "all", label: "All" };
const listing = { instrumentKey: "us:ARCX:VOO", ticker: "VOO", symbol: "VOO", micCode: "ARCX", exchange: "NYSE", type: "ETF", currency: "USD", exchangeTimezone: "America/New_York" };
const config = () => ({ provider: { mode: "live", apiKey: "fixture-only", listings: [listing], audience: "member_display",
  license: { status: "confirmed", reference: "fixture", cacheScope: "fixture", expiresAt: new Date(Date.now() + 86400000), datasets: ["us_quote", "usd_krw", "usd_krw_history"], audiences: ["member_display"], quoteDelay: "delayed" },
  release: { approved: true, reference: "fixture" } }, budget: { httpRequestsPerMinute: 10, apiCreditsPerMinute: 10, minimumIntervalMs: 0 }, storage: { retentionSeconds: 86400, quoteFreshSeconds: 600, fxFreshSeconds: 600, historyFreshSeconds: 600 } });
const asset = (extra = {}) => ({ id: "owned-voo", canonicalOwnerUserId: owner, accountId: account, name: "VOO", assetType: "etf", market: "us", currency: "USD", ticker: "VOO", quantity: "2", currentPrice: "100", priceSource: "kis", priceAsOf: new Date(Date.now() - 60000), priceFetchedAt: new Date(Date.now() - 30000), priceQuoteType: "live", priceStatus: "ok", fractionalKrwValue: "0", ...extra });
const emptyEvidence = { status: "missing", prices: [], fx: [], corporateActions: [], corporateActionCoverage: "unknown", analysisEligible: false, refreshDue: true, queuedCount: 0 };

async function fixture({ assets = [asset()], ledger = { accounts: [], entries: [], snapshots: [] }, enabled = true, failQuote = false } = {}) {
  const calls = { requests: [], reads: [], historyRequests: [], historyReads: [], tenant: null, ledgerTenant: null };
  const [identity] = await importWithPorts(["src/lib/market-data/twelve-data-identity.ts"], {});
  const price = async query => {
    if (query.kind !== "live") return emptyEvidence;
    if (failQuote) throw new Error("twelve_data_transport_failed");
    return { ...emptyEvidence, status: "admitted", prices: [{ instrumentKey: query.target.key, ticker: query.target.ticker, currency: "USD", value: "125.125", observedAt: new Date(Date.parse(query.asOf) - 10000).toISOString(), fetchedAt: new Date(Date.parse(query.asOf) - 5000).toISOString(), source: "twelve_data" }] };
  };
  const history = async query => ({ status: "admitted", missingAt: [], conflictAt: [], queuedCount: 0, fx: query.requestedAt.map(at => ({ baseCurrency: "USD", quoteCurrency: "KRW", rate: "1300", requestedAt: at, observedAt: new Date(Date.parse(at) - 1000).toISOString(), fetchedAt: new Date(Date.parse(query.asOf) - 1000).toISOString(), source: "twelve_data", kind: "historical_spot" })) });
  const [loader] = await importWithPorts(["src/db/queries/currency-tracked-portfolio.ts"], {
    "./portfolio-dashboard": { getReadOnlyTenantPortfolioDashboardSources: async input => { calls.tenant = input.tenantContext; return { assetRows: assets, settingsRows: [], liveQuoteRows: [], recentFxRows: [] }; } },
    "./native-portfolio-ledger": { readNativeLedger: async tenant => { calls.ledgerTenant = tenant; return ledger; } },
    "@/lib/market-data/twelve-data-service": {
      getTwelveDataServerConfig: () => enabled ? config() : undefined,
      resolveTwelveDataTarget: identity.resolveTwelveDataTarget,
      requestTwelveDataEvidence: async query => { calls.requests.push(query); return price(query); },
      readTwelveDataEvidence: async query => { calls.reads.push(query); return price(query); },
      requestTwelveDataHistoricalFx: async query => { calls.historyRequests.push(query); return history(query); },
      readTwelveDataHistoricalFx: async query => { calls.historyReads.push(query); return history(query); },
      readTwelveDataSplitRisk: async () => ({ status: "disabled", actions: [] }),
      requestTwelveDataSplitRisk: async () => ({ status: "disabled", actions: [] }),
    },
  });
  return { loader, calls };
}

describe("tracked owner provider integration with isolated boundary ports", () => {
  it("uses reviewed identity once for duplicate holdings and preserves an unsupported holding", async () => {
    const { loader, calls } = await fixture({ assets: [asset(), asset({ id: "second-voo" }), asset({ id: "unreviewed", ticker: "UNKNOWN", priceAsOf: null })] });
    const result = await loader.getTrackedCurrencyEvidence({ ownerUserId: owner }, scope, "USD");
    assert.equal(calls.requests.length, 1); assert.equal(calls.requests[0].target.key, listing.instrumentKey);
    assert.equal(result.current.positions[0].observation.price, "125.125"); assert.equal(result.current.positions[1].observation.price, "125.125");
    assert.equal(result.current.positions[2].observation, null); assert.equal(result.current.positions.length, 3);
    assert.equal(calls.tenant.ownerUserId, owner); assert.equal(calls.ledgerTenant.ownerUserId, owner);
  });

  it("keeps admitted KIS evidence when one provider request fails", async () => {
    const { loader } = await fixture({ failQuote: true });
    const result = await loader.getTrackedCurrencyEvidence({ ownerUserId: owner }, scope, "USD");
    assert.equal(result.current.positions[0].observation.price, "100"); assert.equal(result.current.positions[0].observation.source, "kis");
  });

  it("read-only captures preserve one asOf and request no collection, including cost/event/snapshot FX", async () => {
    const costAt = "2026-08-01T12:00:00.000Z", snapshotAt = "2026-08-10T22:00:00.000Z", eventAt = "2026-08-12T12:00:00.000Z";
    const holding = asset(), lot = { amount: "200", currency: "USD", at: costAt, source: "user_native_ledger", remaining: { n: "1", d: "1" } };
    const ledger = { accounts: [{ id: account, name: "Owned", active: true, assets: [{ id: holding.id, quantity: "2", currency: "USD", archived: false }], state: { sequence: 1, at: eventAt, cash: { USD: "10", KRW: "0" }, positions: [{ assetId: holding.id, quantity: "2", currency: "USD", costLots: [lot] }] } }],
      entries: [{ id: "deposit", accountId: account, data: { state: { sequence: 1 }, event: { type: "deposit", at: eventAt }, effect: { cashLegs: [{ currency: "USD", delta: "10", kind: "external" }] } } }],
      snapshots: [{ accountId: account, evidence: { version: 1, sequence: 0, fx: [], frame: { at: snapshotAt, source: "native_ledger_snapshot", scopeComplete: true, positions: [{ id: holding.id, accountId: account, ownerId: owner, name: "VOO", kind: "holding", observation: { quantity: "2", price: "90", currency: "USD", at: snapshotAt, priceObservedAt: snapshotAt, basis: "raw", source: "kis" }, costLots: [lot] }] } } }] };
    const { loader, calls } = await fixture({ ledger, assets: [holding] });
    const asOf = new Date(Date.now() - 2000);
    const result = await loader.getTrackedCurrencyEvidence({ ownerUserId: owner }, scope, "KRW", { asOf, collect: false });
    assert.equal(result.asOf, asOf.toISOString()); assert.equal(calls.requests.length, 0); assert.equal(calls.historyRequests.length, 0);
    assert.equal(calls.reads.length, 2); assert.equal(calls.historyReads.length, 1);
    assert.deepEqual(calls.historyReads[0].requestedAt, [costAt, snapshotAt, eventAt]);
    assert.equal(calls.historyReads[0].knownAt, asOf.toISOString());
    assert.ok(result.fx.every(rate => rate.kind === "historical_spot" && rate.requestedAt && Date.parse(rate.observedAt) <= Date.parse(rate.requestedAt)));
  });
});

describe("existing worker independently resumes the Twelve Data partition", () => {
  it("runs the configured resumer even when KIS queue is idle or its availability check fails", async () => {
    for (const fail of [false, true]) {
      const scheduled = []; let resumed = 0;
      const [worker] = await importWithPorts(["src/lib/market-data/collection-worker.ts"], {
        "next/server": { after: callback => scheduled.push(callback) },
        "@/db/client": { db: {} }, "@/db/schema": { fxRates: {}, livePriceQuotes: {} },
        "@/lib/market-data/collection-queue": { claimMarketCollection: async () => null, finishMarketCollection: async () => {}, getMarketCollectionSummary: async () => ({}), maintainMarketCollection: async () => {}, hasReadyMarketCollection: async () => { if (fail) throw new Error("isolated_kis_unavailable"); return false; } },
        "@/lib/market-data/kis-refresh-lease": { KisRefreshLeaseBusyError: class extends Error {}, withKisCollectionLease: async callback => callback() },
        "@/lib/market-data/price-sync": { runMarketPriceSync: async () => {} },
        "@/lib/market-data/kis-history-cache-sync": { runKisHistoryCacheSync: async () => {} },
        "@/lib/market-data/providers/kis": { createKisMarketDataProvider: () => ({}), createKisProviderRequestSession: () => ({}), fetchKisUsdKrwFxCandidate: async () => ({}), getKisProviderPolicy: () => ({ configured: false }) },
        "@/lib/market-data/fx-refresh-job": { runUsdKrwFxCandidateJob: async () => {} },
        "@/lib/market-data/provider-budget": { withKisCollectionDeadline: async callback => callback() },
        "@/lib/market-data/latest-close-revalidation": { revalidateLatestClose: async () => {} },
        "@/lib/market-data/twelve-data-service": { resumeConfiguredTwelveDataService: async () => { resumed++; } },
      });
      worker.scheduleMarketCollection(); assert.equal(scheduled.length, 1); assert.equal(resumed, 0);
      await scheduled[0](); assert.equal(resumed, 1); assert.equal(scheduled.length, 1);
    }
  });
});
