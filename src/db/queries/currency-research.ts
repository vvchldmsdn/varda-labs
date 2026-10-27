import "server-only";
import { db } from "@/db/client";
import { assetPriceSnapshots, fxRates } from "@/db/schema";
import { and, eq, inArray, gte, lte, asc, desc, or, sql } from "drizzle-orm";
import { listPortfolioDrafts } from "./portfolio-drafts";
import { QUICK_INSTRUMENTS } from "@/lib/quick-portfolio";
import { admitSharedKisRawHistoricalPriceRows } from "@/lib/market-data/asset-price-consumer-admission";
import { mapRiskEvidenceDateToServiceDate, isRiskDate, shiftRiskDate } from "@/lib/portfolio-risk-calendar";
import { isCurrency, Decimal, type Currency } from "@/lib/money";
import { fxFactor } from "@/lib/currency-valuation";
import { getTrackedCurrencyEvidence } from "./currency-tracked-portfolio";
import { buildTrackedCurrencyPortfolio, type TrackedPortfolioEvidence } from "@/lib/currency-tracked-portfolio";
import { calculateCurrencyModifiedDietz } from "@/lib/currency-performance";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import { getTwelveDataServerConfig, requestTwelveDataEvidence, resolveTwelveDataTarget, getTwelveDataCompletedHistoryWindow, requestTwelveDataHistoricalFx } from "@/lib/market-data/twelve-data-service";
import { normalizeNativeResearchHistory, normalizeStoredNativeResearchHistory } from "@/lib/native-research-history";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { CurrencyResearchInput, CurrencyResearchHistory } from "@/lib/currency-research";

/** Saved input is owner-scoped first. Then bounded shared-market reads, never provider calls. */
export async function getSavedCurrencyResearch(tenant: TenantContext, id?: string): Promise<CurrencyResearchInput | null> {
  const drafts = await listPortfolioDrafts(tenant);
  const saved = id ? drafts.find(row => row.id === id) : drafts[0];
  if (!saved) return null;
  const instruments = saved.input.rows.flatMap(row => { const instrument = QUICK_INSTRUMENTS.find(item => item.id === row.instrumentId); return instrument ? [instrument] : []; });
  const now = new Date();
  const endDate = now.toISOString().slice(0, 10);
  const startDate = new Date(now.getTime() - 400 * 86400000).toISOString().slice(0, 10);
  const [prices, rates] = instruments.length ? await Promise.all([
    db.select({ ticker: assetPriceSnapshots.ticker, market: assetPriceSnapshots.market, currency: assetPriceSnapshots.currency,
      priceDate: assetPriceSnapshots.priceDate, closePrice: assetPriceSnapshots.closePrice, source: assetPriceSnapshots.source,
      providerSymbol: assetPriceSnapshots.providerSymbol, providerExchange: assetPriceSnapshots.providerExchange, fetchedAt: assetPriceSnapshots.fetchedAt })
      .from(assetPriceSnapshots).where(and(inArray(assetPriceSnapshots.ticker, instruments.map(item => item.ticker)), eq(assetPriceSnapshots.isSample, false), gte(assetPriceSnapshots.priceDate, startDate), lte(assetPriceSnapshots.priceDate, endDate)))
      .orderBy(asc(assetPriceSnapshots.priceDate)).limit(5000),
    db.select({ rate: fxRates.usdKrw, observedAt: fxRates.observedAt, fetchedAt: fxRates.fetchedAt, source: fxRates.source, kind: fxRates.rateKind })
      .from(fxRates).where(and(eq(fxRates.isSample, false), eq(fxRates.status, "ok"), eq(fxRates.rateKind, "daily_reference"), gte(fxRates.rateDate, startDate), lte(fxRates.rateDate, endDate))).orderBy(desc(fxRates.observedAt), desc(fxRates.fetchedAt)).limit(500),
  ]) : [[], []];
  const histories: CurrencyResearchHistory[] = instruments.map(instrument => {
    const market = instrument.market === "KRX" ? "korea" : "us";
    const original = prices.filter(row => row.market.toLowerCase().trim() === market && row.currency === instrument.currency && row.ticker === instrument.ticker &&
      (!("mic" in instrument) || ["NAS", "NASD", "NASDAQ", "XNAS"].includes(row.providerExchange?.toUpperCase() ?? "")));
    const admission = admitSharedKisRawHistoricalPriceRows(original);
    // A missing/excluded row is not silently removed to form an apparently complete series.
    const rows = admission.rows.length === original.length ? admission.rows : [];
    return { instrumentId: instrument.id, source: "stored_kis_raw_close", admission: "shared_kis_raw",
      points: rows.flatMap(row => {
        const at = new Date(`${mapRiskEvidenceDateToServiceDate(row.priceDate)}T07:00:00+09:00`).toISOString();
        if (Date.parse(at) > now.getTime() || !isCurrency(row.currency) || !row.fetchedAt || new Date(row.fetchedAt).getTime() > now.getTime()) return [];
        return [{ at, price: String(row.closePrice), currency: row.currency, basis: "raw_price" as const, dataset: `${row.source}|${row.providerExchange}|${row.providerSymbol}|raw` }];
      }),
    };
  });
  return { input: saved.input, reportingCurrency: saved.input.currency, asOf: now.toISOString(), histories,
    fx: rates.flatMap(row => row.observedAt && row.fetchedAt && row.source && (row.kind === "spot" || row.kind === "daily_reference")
      ? [{ base: "USD" as const, quote: "KRW" as const, rate: row.rate, observedAt: row.observedAt.toISOString(), fetchedAt: row.fetchedAt.toISOString(), source: row.source, kind: row.kind }] : []),
    provenance: "stored_market_history" };
}

/** Native owner values feed a hypothetical current-allocation experiment. Actual
 * recorded performance is an independent result with its own dates and cash flows. */
export async function getOwnedCurrencyResearchInput(tenant: TenantContext, scope: PortfolioAnalysisScope, reporting: Currency, options: { horizon?: number; endServiceDate?: string; valuationEvidence?: TrackedPortfolioEvidence; calculation?: "risk_only" } = {}): Promise<CurrencyResearchInput | null> {
  const evidence = options.valuationEvidence ?? await getTrackedCurrencyEvidence(tenant, scope, reporting);
  if (evidence.ownerId !== tenant.ownerUserId) throw new Error("currency_research_owner_mismatch");
  if (evidence.reporting !== reporting) throw new Error("currency_research_reporting_mismatch");
  const report = buildTrackedCurrencyPortfolio(evidence);
  const current = report.current;
  if (!current?.complete) return null;
  const asOf = evidence.asOf;
  const config = getTwelveDataServerConfig();
  const memberConfig = config?.provider.audience === "member_display" ? config : undefined;
  let { startDate, endDate } = getTwelveDataCompletedHistoryWindow(asOf, 365);
  let historyEndAt: string | undefined;
  let actualWindowEndAt: string | undefined;
  if (options.endServiceDate !== undefined) {
    if (!isRiskDate(options.endServiceDate)) return null;
    historyEndAt = new Date(`${options.endServiceDate}T07:00:00+09:00`).toISOString();
    if (Date.parse(historyEndAt) > Date.parse(asOf)) return null;
    // A service date includes its delayed capture; it does not end exactly at
    // the opening 07:00 boundary or invent a value at that boundary.
    actualWindowEndAt = new Date(Math.min(Date.parse(asOf), Date.parse(`${shiftRiskDate(options.endServiceDate, 1)}T07:00:00+09:00`) - 1)).toISOString();
    endDate = [endDate, shiftRiskDate(options.endServiceDate, -1)].sort()[0];
    startDate = shiftRiskDate(endDate, -364);
  }
  const holdings = evidence.current.positions.filter(row => row.observation && Decimal.from(row.observation.quantity).compare(0) > 0);
  const securities = holdings.filter(row => row.kind !== "cash");
  // Shared prices are selected only after the authenticated owned universe. An
  // exact market/currency/ticker predicate keeps same-ticker listings separate.
  const identities = securities.filter(row => row.ticker && ["us", "korea"].includes(row.market ?? "")).map(row => ({ ticker: row.ticker!.trim().toUpperCase(), market: row.market!, currency: row.observation!.currency }));
  const [storedPrices, storedFx] = await Promise.all([
    identities.length ? db.select({ ticker: assetPriceSnapshots.ticker, market: assetPriceSnapshots.market, currency: assetPriceSnapshots.currency,
      priceDate: assetPriceSnapshots.priceDate, closePrice: assetPriceSnapshots.closePrice, source: assetPriceSnapshots.source,
      providerSymbol: assetPriceSnapshots.providerSymbol, providerExchange: assetPriceSnapshots.providerExchange, fetchedAt: assetPriceSnapshots.fetchedAt })
      .from(assetPriceSnapshots).where(and(eq(assetPriceSnapshots.isSample, false), gte(assetPriceSnapshots.priceDate, startDate), lte(assetPriceSnapshots.priceDate, endDate),
        or(...identities.map(identity => and(eq(sql`upper(trim(${assetPriceSnapshots.ticker}))`, identity.ticker), eq(sql`lower(trim(${assetPriceSnapshots.market}))`, identity.market), eq(assetPriceSnapshots.currency, identity.currency))))))
      .orderBy(asc(assetPriceSnapshots.priceDate)).limit(identities.length * 366 + 1) : Promise.resolve([]),
    db.select({ rate: fxRates.usdKrw, observedAt: fxRates.observedAt, fetchedAt: fxRates.fetchedAt, source: fxRates.source, kind: fxRates.rateKind })
      .from(fxRates).where(and(eq(fxRates.isSample, false), eq(fxRates.status, "ok"), eq(fxRates.rateKind, "daily_reference"), gte(fxRates.rateDate, startDate), lte(fxRates.rateDate, asOf.slice(0, 10))))
      .orderBy(asc(fxRates.observedAt)).limit(500),
  ]);
  if (storedPrices.length > identities.length * 366) throw new Error("currency_research_history_window_exceeded");
  const histories = await Promise.all(holdings.filter(row => row.kind !== "cash").map(async row => {
    const original = storedPrices.filter(price => price.market.trim().toLowerCase() === row.market && price.currency === row.observation!.currency && price.ticker.trim().toUpperCase() === row.ticker?.trim().toUpperCase());
    const fallback = normalizeStoredNativeResearchHistory(row.id, original, asOf);
    if (row.market !== "us" || !row.ticker) return fallback;
    const resolved = resolveTwelveDataTarget({ ticker: row.ticker, market: row.market, currency: row.observation!.currency }, memberConfig);
    if (resolved.status !== "resolved") return fallback;
    try {
      const stored = await requestTwelveDataEvidence({ kind: "history", asOf, startDate, endDate, target: resolved.target }, memberConfig);
      const normalized = normalizeNativeResearchHistory(row.id, stored, asOf);
      return normalized.points.length ? normalized : fallback;
    } catch { return fallback; }
  }));
  const axis = histories.find(history => history.points.length)?.points.map(point => point.at) ?? [];
  for (const cash of holdings.filter(row => row.kind === "cash")) histories.push({ instrumentId: cash.id, source: "native_cash_unit_without_interest", admission: "native_cash",
    points: axis.map(at => ({ at, price: "1", currency: cash.observation!.currency, basis: "raw_price", dataset: `cash:${cash.observation!.currency}:no_interest` })),
    corporateActions: { status: "verified_no_actions", source: "cash_is_currency_not_security", from: axis[0] ?? asOf, through: axis.at(-1) ?? asOf } });
  const fx = [...evidence.fx, ...storedFx.flatMap(row => row.observedAt && row.fetchedAt && row.source && row.kind === "daily_reference" && row.observedAt.getTime() <= Date.parse(asOf) && row.fetchedAt.getTime() <= Date.parse(asOf)
    ? [{ base: "USD" as const, quote: "KRW" as const, rate: row.rate, observedAt: row.observedAt.toISOString(), fetchedAt: row.fetchedAt.toISOString(), source: row.source, kind: "daily_reference" as const }] : [])];
  const historicalFx = fx.filter(rate => rate.kind === "daily_reference" || rate.kind === "historical_spot");
  const requestedAt = [...new Set(histories.flatMap(history => history.points.filter(point => point.currency !== reporting && !fxFactor(point.currency, reporting, point.at, historicalFx, evidence.maxFxAgeMs).ok).map(point => point.at)))];
  if (requestedAt.length) {
    try {
      const historical = await requestTwelveDataHistoricalFx({ requestedAt, asOf }, memberConfig);
      fx.push(...historical.fx.map(rate => ({ base: rate.baseCurrency, quote: rate.quoteCurrency, rate: rate.rate, observedAt: rate.observedAt, fetchedAt: rate.fetchedAt, source: rate.source, kind: rate.kind, requestedAt: rate.requestedAt, provider: "twelve_data" as const })));
    } catch { /* Keep the original missing-FX evidence; the engine blocks the result. */ }
  }
  const actualWindow = [...report.history, current].filter(frame => !actualWindowEndAt || Date.parse(frame.at) <= Date.parse(actualWindowEndAt));
  const start = actualWindow[0], finish = actualWindow.at(-1);
  const actualComplete = evidence.ledgerComplete === true && evidence.cashFlows !== undefined && actualWindow.every(frame => frame.complete);
  const externalFlows = (evidence.cashFlows ?? []).filter(flow => (flow.kind === "external" || flow.externalToScope) && start && finish && (Date.parse(flow.at) > Date.parse(start.at) || (start.boundary === "before" && Date.parse(flow.at) === Date.parse(start.at))) && (Date.parse(flow.at) < Date.parse(finish.at) || (finish.boundary !== "before" && Date.parse(flow.at) === Date.parse(finish.at)))).map(flow => ({ id: flow.id, at: flow.at, dateEvidence: flow.dateEvidence, currency: flow.currency,
    amount: Decimal.from(flow.delta).compare(0) < 0 ? Decimal.from(flow.delta).mul(-1).toExactString() : flow.delta,
    direction: Decimal.from(flow.delta).compare(0) < 0 ? "outflow" as const : "inflow" as const }));
  const boundary = evidence.groupEvidence ? "selected_group" as const : "portfolio_including_cash" as const;
  const performance = historyEndAt ? actualComplete && actualWindow.length >= 2 ? calculateCurrencyModifiedDietz({ reporting, cashFlowEvidence: "complete", fx, maxFxAgeMs: evidence.maxFxAgeMs, boundary,
    valuations: actualWindow.map(frame => ({ boundary: frame.boundary, amount: frame.total!, currency: reporting, at: frame.at, serviceDate: resolveSnapshotCycle(new Date(frame.at)).snapshotDate, source: "owned_native_capture" })),
    flows: externalFlows.map(flow => ({ ...flow, serviceDate: resolveSnapshotCycle(new Date(flow.at)).snapshotDate, source: "owned_native_external_flow", kind: flow.direction === "inflow" ? "external_in" as const : "external_out" as const })) }) : null
    : "performanceReturn" in report ? report.performanceReturn : null;
  const actualBoundary = performance && "boundary" in performance ? performance.boundary : boundary;
  return { input: { version: 3, source: "owned_native", ownerId: tenant.ownerUserId, currency: reporting, asOf, timeZone: "Asia/Seoul",
    rows: holdings.map(row => ({ name: row.name, value: Decimal.from(row.observation!.quantity).mul(row.observation!.price).toNumber(), inputCurrency: row.observation!.currency, nativeCurrency: row.observation!.currency, instrumentId: row.id })) },
    reportingCurrency: reporting, asOf, histories, fx, provenance: "owned_native_history",
    ...(options.horizon === undefined ? {} : { horizon: options.horizon }),
    ...(historyEndAt === undefined ? {} : { historyEndAt }),
    ...(options.calculation === undefined ? {} : { calculation: options.calculation }),
    actualPortfolio: { reportingCurrency: reporting, from: actualWindow.length >= 2 ? start.at : null, to: finish?.at ?? historyEndAt ?? current.at, valuationCount: actualWindow.length,
      totalReturnPct: performance?.status === "ready" ? performance.totalReturn * 100 : null,
      method: actualBoundary === "selected_group" ? "modified_dietz_selected_group" : "modified_dietz_including_cash", boundary: actualBoundary,
      reason: performance?.status === "ready" ? null : "actual_cash_flow_performance_incomplete" },
    counterfactual: { reportingCurrency: reporting, asOf, complete: actualComplete,
      actualPath: actualWindow.map(frame => ({ boundary: frame.boundary, at: frame.at, totalValue: frame.total ?? "0" })),
      externalFlows,
    },
  };
}
