import "server-only";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { etfHoldings, etfMasters } from "@/db/schema";
import { instrumentCatalog } from "@/db/instrument-catalog-schema";
import { canonicalCatalogInstrument, canonicalOnboardingInstrument, instrumentSearchLikePattern, parseOnboardingInstrumentId, parseOnboardingInstrumentSearch, rankOnboardingInstruments, type OnboardingInstrument } from "@/lib/onboarding-instrument-search";

const catalogFields = { id: instrumentCatalog.id, name: instrumentCatalog.name, ticker: instrumentCatalog.ticker, market: instrumentCatalog.market, currency: instrumentCatalog.currency, assetType: instrumentCatalog.assetType };
const catalogAdmission = () => eq(instrumentCatalog.isActive, true);
const masterFields = { id: etfMasters.id, name: etfMasters.name, ticker: etfMasters.ticker, market: etfMasters.market, currency: etfMasters.currency };
const stockFields = { id: etfHoldings.id, name: etfHoldings.holdingName, ticker: etfHoldings.holdingSymbol, market: etfHoldings.holdingMarket, currency: etfHoldings.currency };
const masterAdmission = () => and(eq(etfMasters.isActive, true), eq(etfMasters.isSample, false));
const stockAdmission = () => and(masterAdmission(), eq(etfHoldings.isSample, false), sql`lower(${etfHoldings.securityType}) = 'stock'`,
  // Historical composition is not a current security catalog. Admit the latest real composition only.
  sql`${etfHoldings.asOfDate} = (select max(reference.as_of_date) from etf_holdings as reference where reference.etf_master_id = ${etfMasters.id} and reference.is_sample = false)`);

/** Shared reference metadata only. Caller must authenticate before invoking this query. */
export async function searchOnboardingInstruments(input: string): Promise<readonly OnboardingInstrument[]> {
  const query = parseOnboardingInstrumentSearch(input);
  if (!query) return [];
  const pattern = instrumentSearchLikePattern(query);
  const [catalog, masters, stocks] = await Promise.all([
    db.select(catalogFields).from(instrumentCatalog).where(and(catalogAdmission(), or(ilike(instrumentCatalog.name, pattern), ilike(instrumentCatalog.ticker, pattern))))
      .orderBy(sql`case when lower(${instrumentCatalog.ticker}) = lower(${query}) then 0 when lower(${instrumentCatalog.name}) = lower(${query}) then 1 else 2 end`, asc(instrumentCatalog.ticker)).limit(36),
    db.select(masterFields).from(etfMasters).where(and(masterAdmission(), sql`not exists (select 1 from instrument_catalog c where c.market = case when lower(btrim(${etfMasters.market})) in ('korea','kr','krx') then 'korea' else lower(btrim(${etfMasters.market})) end and c.currency = upper(btrim(${etfMasters.currency})) and c.ticker = upper(btrim(${etfMasters.ticker})))`, or(ilike(etfMasters.name, pattern), ilike(etfMasters.ticker, pattern))))
      .orderBy(sql`case when lower(${etfMasters.ticker}) = lower(${query}) then 0 else 1 end`, asc(etfMasters.ticker)).limit(36),
    db.select(stockFields).from(etfHoldings).innerJoin(etfMasters, eq(etfMasters.id, etfHoldings.etfMasterId))
      .where(and(stockAdmission(), sql`not exists (select 1 from instrument_catalog c where c.market = case when lower(btrim(${etfHoldings.holdingMarket})) in ('korea','kr','krx') then 'korea' else lower(btrim(${etfHoldings.holdingMarket})) end and c.currency = upper(btrim(${etfHoldings.currency})) and c.ticker = upper(btrim(${etfHoldings.holdingSymbol})))`, or(ilike(etfHoldings.holdingName, pattern), ilike(etfHoldings.holdingSymbol, pattern))))
      .orderBy(sql`case when lower(${etfHoldings.holdingSymbol}) = lower(${query}) then 0 else 1 end`, desc(etfHoldings.asOfDate), asc(etfHoldings.holdingSymbol)).limit(36),
  ]);
  return rankOnboardingInstruments([
    ...catalog.map(canonicalCatalogInstrument),
    ...masters.map(row => canonicalOnboardingInstrument(row, "etf")),
    ...stocks.map(row => canonicalOnboardingInstrument(row, "stock")),
  ].filter((row): row is OnboardingInstrument => row !== null), query);
}

/** Re-resolve a submitted selection; client names, markets and symbols are not authoritative. */
export async function resolveOnboardingInstrumentById(input: string): Promise<OnboardingInstrument | null> {
  const selection = parseOnboardingInstrumentId(input);
  if (!selection) return null;
  if (selection.kind === "catalog") {
    const [row] = await db.select(catalogFields).from(instrumentCatalog).where(and(catalogAdmission(), eq(instrumentCatalog.id, selection.id))).limit(1);
    return row ? canonicalCatalogInstrument(row) : null;
  }
  if (selection.kind === "etf") {
    const [row] = await db.select(masterFields).from(etfMasters).where(and(masterAdmission(), eq(etfMasters.id, selection.id))).limit(1);
    return row ? canonicalOnboardingInstrument(row, "etf") : null;
  }
  const [row] = await db.select(stockFields).from(etfHoldings).innerJoin(etfMasters, eq(etfMasters.id, etfHoldings.etfMasterId))
    .where(and(stockAdmission(), eq(etfHoldings.id, selection.id))).limit(1);
  return row ? canonicalOnboardingInstrument(row, "stock") : null;
}
