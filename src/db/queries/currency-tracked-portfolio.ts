import "server-only";
import { getReadOnlyTenantPortfolioDashboardSources } from "./portfolio-dashboard";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TrackedPortfolioEvidence, TrackedNativePosition } from "@/lib/currency-tracked-portfolio";
import { isCurrency, Decimal, type Currency } from "@/lib/money";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import { resolveAdditionalContributionPolicyParameters } from "@/lib/additional-contribution-policy-input";
import { readNativeLedger } from "./native-portfolio-ledger";
import { attachNativeLedgerEvidence } from "@/lib/native-portfolio-projection";
import { resolveNativeGroupSelection } from "@/lib/native-group-scope";
import { loadTenantPortfolioGroupMemberships } from "./tenant-group-reads";
import { fxFactor } from "@/lib/currency-valuation";
import { getTwelveDataServerConfig, requestTwelveDataEvidence, readTwelveDataEvidence, resolveTwelveDataTarget, requestTwelveDataHistoricalFx, readTwelveDataHistoricalFx, readTwelveDataSplitRisk, requestTwelveDataSplitRisk } from "@/lib/market-data/twelve-data-service";

/** Preserve native decimal quantities/prices. Existing account/asset ownership predicates remain authoritative. */
export async function getTrackedCurrencyEvidence(tenant: TenantContext, scope: PortfolioAnalysisScope, reporting: Currency, options: { asOf?: Date; collect?: boolean } = {}): Promise<TrackedPortfolioEvidence & { contributionPolicy: ReturnType<typeof resolveAdditionalContributionPolicyParameters> }> {
  const now = options.asOf ?? new Date();
  if (!Number.isFinite(now.getTime()) || now.getTime() > Date.now()) throw new Error("currency_valuation_time_invalid");
  const providerEvidence = options.collect === false ? readTwelveDataEvidence : requestTwelveDataEvidence;
  const historicalFxEvidence = options.collect === false ? readTwelveDataHistoricalFx : requestTwelveDataHistoricalFx;
  const splitRiskEvidence = options.collect === false ? readTwelveDataSplitRisk : requestTwelveDataSplitRisk;
  const sources = await getReadOnlyTenantPortfolioDashboardSources({ tenantContext: tenant, scope, serviceDate: resolveSnapshotCycle(now).snapshotDate });
  if (sources.assetRows.some(asset => asset.canonicalOwnerUserId !== tenant.ownerUserId)) throw new Error("currency_owner_scope_mismatch");
  const at = now.toISOString();
  const positions: TrackedNativePosition[] = sources.assetRows.map(asset => {
    const base = { id: asset.id, ownerId: asset.canonicalOwnerUserId ?? "", name: asset.name, ticker: asset.ticker, market: asset.market, observation: null, cost: null };
    if (!["stock", "etf"].includes(asset.assetType ?? "etf") || !["korea", "us"].includes(asset.market.toLowerCase()) || !isCurrency(asset.currency)) return { ...base, unsupportedReason: asset.assetType === "commodity" ? "manual_gold" : "unsupported_instrument" };
    // A separate fractional KRW balance is not a native quantity and has no valuation date here.
    if (asset.fractionalKrwValue && Decimal.from(asset.fractionalKrwValue).compare(0) !== 0) return { ...base, unsupportedReason: "fractional_value_not_dated" };
    const quotes = sources.liveQuoteRows.filter(quote => quote.market.toLowerCase() === asset.market.toLowerCase() && quote.currency === asset.currency && quote.ticker.toUpperCase() === asset.ticker?.toUpperCase());
    const quote = quotes.find(row => row.source.startsWith("kis") && row.provider === "kis" && row.status === "ok" && row.priceAsOf && row.priceAsOf.getTime() <= now.getTime() && row.priceAsOf <= row.fetchedAt && row.fetchedAt.getTime() <= now.getTime() && ["live", "close"].includes(row.quoteType) && Decimal.from(row.price).compare(0) > 0);
    const source = quote?.source ?? asset.priceSource;
    const observedAt = quote?.priceAsOf ?? asset.priceAsOf;
    const fetchedAt = quote?.fetchedAt ?? asset.priceFetchedAt;
    const status = quote?.status ?? asset.priceStatus;
    const quoteType = quote?.quoteType ?? asset.priceQuoteType;
    // Do not admit a new provider without the matching licensing/admission path.
    if (!source?.startsWith("kis") || !observedAt || !fetchedAt || observedAt > now || fetchedAt > now || observedAt > fetchedAt || status !== "ok" || !["live", "close"].includes(quoteType ?? "")) return base;
    return { ...base, observation: { quantity: asset.quantity, price: quote?.price ?? asset.currentPrice, currency: asset.currency, at, priceObservedAt: observedAt.toISOString(), basis: "raw", source } };
  });
  const evidence: TrackedPortfolioEvidence = { ownerId: tenant.ownerUserId, reporting, asOf: at,
    current: { at, source: "owned_native_asset_and_kis_quote", positions, scopeComplete: false },
    // Legacy snapshots lack separate native-price observation timestamps. They are not relabeled as USD history.
    history: [], trades: null,
    fx: sources.recentFxRows.flatMap(row => row.observedAt && row.fetchedAt && row.source && (row.rateKind === "spot" || row.rateKind === "daily_reference")
      ? [{ base: "USD" as const, quote: "KRW" as const, rate: String(row.usdKrw), observedAt: row.observedAt.toISOString(), fetchedAt: row.fetchedAt.toISOString(), source: row.source, kind: row.rateKind }] : []),
    maxFxAgeMs: 3 * 86400000, maxPriceAgeMs: 10 * 86400000 };
  const ledger = await readNativeLedger(tenant, scope.kind === "account" ? scope.accountId : undefined);
  const config = getTwelveDataServerConfig();
  if (config?.provider.audience === "member_display") {
    const targets = new Map<string, { target: Extract<ReturnType<typeof resolveTwelveDataTarget>, { status: "resolved" }>["target"]; assets: typeof sources.assetRows }>();
    for (const asset of sources.assetRows) {
      if (positions.find(row => row.id === asset.id)?.unsupportedReason) continue;
      const resolved = resolveTwelveDataTarget({ ticker: asset.ticker, market: asset.market, currency: asset.currency }, config);
      if (resolved.status !== "resolved") continue;
      const group = targets.get(resolved.target.key) ?? { target: resolved.target, assets: [] };
      group.assets.push(asset); targets.set(resolved.target.key, group);
    }
    const needCurrentFx = sources.assetRows.some(asset => isCurrency(asset.currency) && asset.currency !== reporting) || ledger.accounts.some(account => account.state && Decimal.from(account.state.cash[reporting === "USD" ? "KRW" : "USD"]).compare(0) !== 0);
    const [providerFx] = await Promise.allSettled([
      // Preserve already-known FX in a USD-only snapshot too; absent FX creates
      // collection demand only when the requested valuation needs conversion.
      (needCurrentFx ? providerEvidence : readTwelveDataEvidence)({ kind: "fx", asOf: at, knownAt: at }, config),
      ...[...targets.values()].map(async ({ target, assets }) => {
        const observed = await providerEvidence({ kind: "live", asOf: at, knownAt: at, target }, config).catch(() => null);
        const price = observed?.status === "admitted" ? observed.prices.at(-1) : null;
        for (const asset of assets) {
          const row = positions.find(p => p.id === asset.id);
          if (!row) continue;
          if (price?.observedAt && price.instrumentKey === target.key && price.ticker === target.ticker && price.currency === "USD" && price.source === "twelve_data") row.observation = { quantity: asset.quantity, price: price.value, currency: "USD", at, priceObservedAt: price.observedAt, basis: "raw", source: `twelve_data:${price.instrumentKey}` };
          // A bounded history window must not skip the split/quantity check.
          // Cash and other independently evidenced positions remain available.
          if (ledger.entriesComplete === false && (ledger.accountsComplete === false || ledger.accounts.some(account => account.id === asset.accountId && account.state))) {
            row.observation = null; row.evidenceReason = "corporate_actions_pending"; continue;
          }
          const entries = ledger.entries.filter(entry => entry.accountId === asset.accountId);
          const acquired = entries.filter(entry => entry.data.event.type === "opening" ? entry.data.state.positions?.some(position => position.assetId === asset.id) : entry.data.event.type === "buy" && entry.data.event.assetId === asset.id).map(entry => entry.data.event.at).sort()[0];
          // An explicit opening/first buy confirms that day's quantity. Later known
          // splits require a matching owner event; market data never changes shares.
          if (!acquired || !row.observation) continue;
          const recordedSplits = entries.flatMap(entry => entry.data.event.type === "split" && entry.data.event.assetId === asset.id ? [entry.data.event] : []);
          if (recordedSplits.some(event => Date.parse(event.at) > Date.parse(row.observation!.priceObservedAt!) && Date.parse(event.at) <= now.getTime())) {
            row.observation = null; row.evidenceReason = "corporate_action_price_pending"; continue;
          }
          const startDate = new Date(Date.parse(`${usExchangeDate(acquired)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), endDate = usExchangeDate(row.observation.priceObservedAt!);
          // A known later action makes a retained pre-action quote unusable even
          // before the owner has entered the corresponding quantity event.
          if (endDate < usExchangeDate(at)) {
            const followingDate = new Date(Date.parse(`${endDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
            const later = await readTwelveDataSplitRisk({ target, startDate: followingDate, endDate: usExchangeDate(at), asOf: at }, config).catch(() => null);
            if (later?.actions.length || later?.status === "conflict") { row.observation = null; row.evidenceReason = "corporate_action_price_pending"; continue; }
          }
          if (startDate > endDate) continue;
          const risk = await splitRiskEvidence({ target, startDate, endDate, asOf: at }, config).catch(() => ({ status: "conflict", actions: [] }));
          let splitConflict = risk.status !== "admitted";
          try { splitConflict ||= risk.actions.some(action => {
            const matches = entries.flatMap(entry => entry.data.event.type === "split" && entry.data.event.assetId === asset.id && usExchangeDate(entry.data.event.at) === action.date ? [entry.data.event] : []);
            // Twelve's documented 4-for-1 is from=4,to=1; ledger ratio is new/old.
            return matches.length !== 1 || risk.actions.filter(other => other.date === action.date).length !== 1 || Decimal.from(matches[0].ratio.n).mul(action.toFactor!).compare(Decimal.from(matches[0].ratio.d).mul(action.fromFactor!)) !== 0;
          });
            splitConflict ||= recordedSplits.filter(event => usExchangeDate(event.at) >= startDate && usExchangeDate(event.at) <= endDate).some(event =>
              !risk.actions.some(action => action.date === usExchangeDate(event.at) && Decimal.from(event.ratio.n).mul(action.toFactor!).compare(Decimal.from(event.ratio.d).mul(action.fromFactor!)) === 0));
          } catch { splitConflict = true; }
          if (splitConflict) {
            row.observation = null;
            row.evidenceReason = risk.status === "provisional" ? "corporate_actions_provisional" : risk.status === "conflict" ? "corporate_actions_conflict" : risk.status === "admitted" ? "corporate_action_ledger_mismatch" : "corporate_actions_pending";
          }
        }
      }),
    ]);
    if (providerFx.status === "fulfilled" && providerFx.value?.status === "admitted") evidence.fx = [...evidence.fx, ...providerFx.value.fx.map(rate => ({ base: rate.baseCurrency, quote: rate.quoteCurrency, rate: rate.rate, observedAt: rate.observedAt, fetchedAt: rate.fetchedAt, source: rate.source, kind: rate.kind, ...(rate.kind === "historical_spot" ? { requestedAt: rate.requestedAt } : {}) }))];
  }
  const selection = scope.kind === "portfolio_group" ? resolveNativeGroupSelection(await loadTenantPortfolioGroupMemberships({ mode: "all", portfolioGroupId: scope.portfolioGroupId, tenantContext: tenant }), at) : undefined;
  const projected = attachNativeLedgerEvidence(evidence, ledger, scope.kind, selection);
  if (config?.provider.audience === "member_display") {
    const requestedAt = nativeHistoricalFxTimes(projected);
    if (requestedAt.length) {
      // Provider/cache failures leave the dated valuation incomplete, never erase other positions.
      const result = await historicalFxEvidence({ requestedAt, asOf: at, knownAt: at }, config).catch(() => null);
      if (result) projected.fx = [...projected.fx, ...result.fx.map(rate => ({ base: rate.baseCurrency, quote: rate.quoteCurrency, rate: rate.rate, observedAt: rate.observedAt, fetchedAt: rate.fetchedAt, source: rate.source, kind: rate.kind, requestedAt: rate.requestedAt }))];
    }
    // Currency switches may reuse this DTO. Include already stored evidence for
    // the other reporting basis without creating additional provider demand.
    const cachedTimes = nativeHistoricalFxTimes(projected, true).filter(time => !requestedAt.includes(time));
    if (cachedTimes.length) {
      const cached = await readTwelveDataHistoricalFx({ requestedAt: cachedTimes, asOf: at, knownAt: at }, config).catch(() => null);
      if (cached) projected.fx = [...projected.fx, ...cached.fx.map(rate => ({ base: rate.baseCurrency, quote: rate.quoteCurrency, rate: rate.rate, observedAt: rate.observedAt, fetchedAt: rate.fetchedAt, source: rate.source, kind: rate.kind, requestedAt: rate.requestedAt }))];
    }
  }
  return { ...projected, contributionPolicy: resolveAdditionalContributionPolicyParameters(sources.settingsRows[0]) };
}

function usExchangeDate(at: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** Only actual scoped events, acquisitions and stored valuation times create market demand. */
function nativeHistoricalFxTimes(evidence: TrackedPortfolioEvidence, allCurrencies = false) {
  const times = new Set<string>();
  const historical = evidence.fx.filter(rate => rate.kind === "daily_reference" || rate.kind === "historical_spot" || (rate.kind === "spot" && Number.isFinite(Date.parse(rate.capturedAt ?? "")) && Date.parse(rate.observedAt) <= Date.parse(rate.fetchedAt) && Date.parse(rate.fetchedAt) <= Date.parse(rate.capturedAt!) && Date.parse(rate.capturedAt!) <= Date.parse(evidence.asOf)));
  function need(at: string, currency: Currency, recordedValuation = false) {
    if ((!allCurrencies && currency === evidence.reporting) || !Number.isFinite(Date.parse(at)) || Date.parse(at) > Date.parse(evidence.asOf)) return;
    // Captured valuation FX remains immutable. For original costs and cash
    // events, load the requested instant even when an older capture is fresh
    // enough: that capture must not hide a stored event-time observation.
    if (!recordedValuation || !fxFactor(currency, evidence.reporting, at, historical, evidence.maxFxAgeMs).ok) times.add(at);
  }
  for (const frame of evidence.history) for (const row of frame.positions) {
    if (row.observation && Decimal.from(row.observation.quantity).compare(0) !== 0) need(frame.at, row.observation.currency, true);
  }
  for (const frame of [...evidence.history, evidence.current]) for (const row of frame.positions) {
    for (const lot of row.costLots ?? []) if (Decimal.from(lot.amount).compare(0) !== 0 && BigInt(lot.remaining.n) !== BigInt(0)) need(lot.at, lot.currency);
    if (row.cost) need(row.cost.at, row.cost.currency);
  }
  for (const flow of evidence.cashFlows ?? []) if (Decimal.from(flow.delta).compare(0) !== 0) need(flow.at, flow.currency);
  for (const trade of evidence.trades ?? []) if (Decimal.from(trade.quantityDelta).compare(0) !== 0) need(trade.at, trade.currency);
  for (const sale of evidence.realizedTrades ?? []) {
    if (sale.proceeds) need(sale.at, sale.proceeds.currency);
    for (const lot of sale.disposedCostLots ?? []) if (Decimal.from(lot.amount).compare(0) !== 0 && BigInt(lot.remaining.n) !== BigInt(0)) need(lot.at, lot.currency);
  }
  return [...times].sort().slice(0, 1000);
}
