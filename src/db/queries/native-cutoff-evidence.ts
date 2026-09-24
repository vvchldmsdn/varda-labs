import "server-only";
import { sqlClient } from "@/db/client";
import { getTenantSqlClient } from "@/db/tenant-client";
import { readNativeLedger } from "./native-portfolio-ledger";
import { buildNativeCutoffEvidence } from "@/lib/snapshots/native-cutoff-evidence";
import { buildCycleForSnapshotDate } from "@/lib/snapshots/market-calendar";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { TrackedNativePosition, TrackedPortfolioEvidence } from "@/lib/currency-tracked-portfolio";
import type { FxEvidence } from "@/lib/currency-valuation";
import { getTwelveDataServerConfig, resolveTwelveDataTarget, readTwelveDataEvidence, readTwelveDataSplitRisk } from "@/lib/market-data/twelve-data-service";
import { Decimal } from "@/lib/money";
import { mapWithConcurrency } from "@/lib/async/map-with-concurrency";

/** Read stored, admitted observations only, including now-archived holdings.
 * No provider call and no timestamp reconstructed from a bare price date. */
export async function readNativeCutoffEvidence(tenant: TenantContext, accountId: string, snapshotDate: string, capturedAt: string) {
  const ledger = await readNativeLedger(tenant, accountId);
  if (!ledger.accounts.length || ledger.accounts.length !== 1 || ledger.accounts[0].id !== accountId) return null;
  const at = buildCycleForSnapshotDate(snapshotDate, new Date(capturedAt)).cycleEndAt.toISOString();
  const [[, assets], rates] = await Promise.all([
    getTenantSqlClient().transaction(tx => [
      tx.query("select set_config('app.current_user_id',$1,true)", [tenant.ownerUserId]),
      tx.query(`select id,name,ticker,market,currency,quantity::text,current_price::text as price,price_source as source,
        price_as_of::text as "observedAt",price_fetched_at::text as "fetchedAt",price_status as status,price_quote_type as "quoteType"
        from assets where canonical_owner_user_id=$1::uuid and account_id=$2::uuid and asset_type in ('stock','etf') limit 201`, [tenant.ownerUserId, accountId]),
    ], { isolationLevel: "RepeatableRead", readOnly: true }),
    // Shared market tables are not tenant tables. Do not broaden tenant grants.
    sqlClient.query(`select usdkrw::text as rate,observed_at::text as "observedAt",fetched_at::text as "fetchedAt",source,rate_kind as kind
      from fx_rates where not is_sample and status='ok' and source is not null and observed_at<=$1::timestamptz and fetched_at<=$1::timestamptz and observed_at<=fetched_at and rate_kind in ('spot','daily_reference')
      order by observed_at desc limit 30`, [at]),
  ]);
  if (assets.length > 200) return null;
  const quotes = assets.length ? await sqlClient.query(`select distinct on(upper(q.ticker),q.market,q.currency) q.ticker,q.market,q.currency,q.price::text,q.source,q.price_as_of::text as "observedAt",q.fetched_at::text as "fetchedAt",q.status,q.quote_type as "quoteType"
    from live_price_quotes q join jsonb_to_recordset($1::jsonb) as a(ticker text,market text,currency text)
      on upper(q.ticker)=upper(a.ticker) and q.market=a.market and q.currency=a.currency
    where q.provider='kis' and q.source like 'kis%' and q.status='ok' and q.quote_type in ('live','close')
      and q.price_as_of<=$2::timestamptz and q.price_as_of<=q.fetched_at and q.fetched_at<=$2::timestamptz
    order by upper(q.ticker),q.market,q.currency,q.price_as_of desc`, [JSON.stringify(assets.map(row => ({ ticker: row.ticker, market: row.market, currency: row.currency }))), at]) : [];
  const rows = assets.map(asset => {
    const quote = quotes.find(row => row.ticker.toUpperCase() === asset.ticker?.toUpperCase() && row.market === asset.market && row.currency === asset.currency);
    return quote ? { ...asset, ...quote } : asset;
  });
  const positions: TrackedNativePosition[] = rows.map(row => ({ id: row.id, name: row.name, ticker: row.ticker, market: row.market, accountId, ownerId: tenant.ownerUserId,
    observation: row.source?.startsWith("kis") && row.status === "ok" && ["live", "close"].includes(row.quoteType) && ["USD", "KRW"].includes(row.currency)
      && Date.parse(row.observedAt) <= Date.parse(row.fetchedAt) && Date.parse(row.fetchedAt) <= Date.parse(at) && Number(row.price) > 0
      ? { quantity: row.quantity, price: row.price, currency: row.currency, at, priceObservedAt: new Date(row.observedAt).toISOString(), priceFetchedAt: new Date(row.fetchedAt).toISOString(), source: row.source, basis: "raw" } : null }));
  const base: TrackedPortfolioEvidence = { ownerId: tenant.ownerUserId, reporting: "USD", asOf: capturedAt, current: { at, source: "stored_kis_evidence", scopeComplete: false, positions }, history: [], trades: null,
    fx: rates.map(row => ({ ...row, observedAt: new Date(row.observedAt).toISOString(), fetchedAt: new Date(row.fetchedAt).toISOString(), base: "USD", quote: "KRW" })) as FxEvidence[], maxFxAgeMs: 3 * 86400000, maxPriceAgeMs: 10 * 86400000 };
  const config = getTwelveDataServerConfig();
  if (config?.provider.audience === "member_display") {
    const cachedFx = await readTwelveDataEvidence({ kind: "fx", asOf: at, knownAt: at, freshnessBasis: "cutoff" }, config).catch(() => null);
    if (cachedFx?.status === "admitted") base.fx = [...base.fx, ...cachedFx.fx.map(rate => ({ base: rate.baseCurrency, quote: rate.quoteCurrency, rate: rate.rate, observedAt: rate.observedAt, fetchedAt: rate.fetchedAt, source: rate.source, kind: rate.kind }))];
    await mapWithConcurrency(positions, 2, async position => {
      const asset = ledger.accounts[0].assets.find(asset => asset.id === position.id);
      if (!asset) return;
      const resolved = resolveTwelveDataTarget(asset, config);
      if (resolved.status !== "resolved") return;
      const cached = await readTwelveDataEvidence({ kind: "live", target: resolved.target, asOf: at, knownAt: at, freshnessBasis: "cutoff" }, config).catch(() => null);
      const price = cached?.status === "admitted" ? cached.prices.at(-1) : null;
      if (price?.observedAt && price.instrumentKey === resolved.target.key && price.currency === asset.currency && price.source === "twelve_data") position.observation = { quantity: asset.quantity, price: price.value, currency: price.currency, at, priceObservedAt: price.observedAt, priceFetchedAt: price.fetchedAt, source: `twelve_data:${price.instrumentKey}`, basis: "raw" };
      const reject = (reason: NonNullable<TrackedNativePosition["evidenceReason"]>) => { position.observation = null; position.evidenceReason = reason; };
      if (!position.observation?.priceObservedAt) { reject("corporate_action_price_pending"); return; }
      const events = ledger.entries.filter(entry => entry.accountId === accountId && Date.parse(entry.data.event.at) < Date.parse(at));
      const acquired = events.find(entry => entry.data.event.type === "opening" ? entry.data.state.positions.some(row => row.assetId === asset.id) : entry.data.event.type === "buy" && entry.data.event.assetId === asset.id)?.data.event.at;
      if (!acquired) { reject("corporate_actions_pending"); return; }
      const startDate = new Date(Date.parse(`${exchangeDate(acquired)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
      const endDate = exchangeDate(position.observation.priceObservedAt);
      if (endDate < exchangeDate(at)) {
        const followingDate = new Date(Date.parse(`${endDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
        const later = await readTwelveDataSplitRisk({ target: resolved.target, startDate: followingDate, endDate: exchangeDate(at), asOf: at }, config).catch(() => null);
        if (later?.actions.length || later?.status === "conflict") { reject("corporate_action_price_pending"); return; }
      }
      if (startDate <= endDate) {
        const risk = await readTwelveDataSplitRisk({ target: resolved.target, startDate, endDate, asOf: at }, config).catch(() => null);
        const splits = events.flatMap(entry => entry.data.event.type === "split" && entry.data.event.assetId === asset.id ? [entry.data.event] : []);
        if (risk?.status !== "admitted" || risk.actions.some(action => {
          const matches = splits.filter(split => exchangeDate(split.at) === action.date);
          return matches.length !== 1 || !action.fromFactor || !action.toFactor || Decimal.from(matches[0].ratio.n).mul(action.toFactor).compare(Decimal.from(matches[0].ratio.d).mul(action.fromFactor)) !== 0;
        }) || splits.some(split => exchangeDate(split.at) >= startDate && exchangeDate(split.at) <= endDate && !risk.actions.some(action => action.date === exchangeDate(split.at)))) { reject("corporate_actions_pending"); return; }
      }
    });
  }
  return buildNativeCutoffEvidence(base, ledger, snapshotDate, capturedAt);
}

function exchangeDate(at: string) { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at)); }
