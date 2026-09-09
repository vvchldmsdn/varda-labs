import "server-only";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { etfHoldings, etfMasters } from "@/db/schema";
import { canonicalOnboardingInstrument, instrumentSearchLikePattern, parseOnboardingInstrumentId, parseOnboardingInstrumentSearch, rankOnboardingInstruments, type OnboardingInstrument } from "@/lib/onboarding-instrument-search";

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
  const [masters, stocks] = await Promise.all([
    db.select(masterFields).from(etfMasters).where(and(masterAdmission(), or(ilike(etfMasters.name, pattern), ilike(etfMasters.ticker, pattern))))
      .orderBy(sql`case when lower(${etfMasters.ticker}) = lower(${query}) then 0 else 1 end`, asc(etfMasters.ticker)).limit(36),
    db.select(stockFields).from(etfHoldings).innerJoin(etfMasters, eq(etfMasters.id, etfHoldings.etfMasterId))
      .where(and(stockAdmission(), or(ilike(etfHoldings.holdingName, pattern), ilike(etfHoldings.holdingSymbol, pattern))))
      .orderBy(sql`case when lower(${etfHoldings.holdingSymbol}) = lower(${query}) then 0 else 1 end`, desc(etfHoldings.asOfDate), asc(etfHoldings.holdingSymbol)).limit(36),
  ]);
  return rankOnboardingInstruments([
    ...masters.map(row => canonicalOnboardingInstrument(row, "etf")),
    ...stocks.map(row => canonicalOnboardingInstrument(row, "stock")),
  ].filter((row): row is OnboardingInstrument => row !== null), query);
}

/** Re-resolve a submitted selection; client names, markets and symbols are not authoritative. */
export async function resolveOnboardingInstrumentById(input: string): Promise<OnboardingInstrument | null> {
  const selection = parseOnboardingInstrumentId(input);
  if (!selection) return null;
  if (selection.kind === "etf") {
    const [row] = await db.select(masterFields).from(etfMasters).where(and(masterAdmission(), eq(etfMasters.id, selection.id))).limit(1);
    return row ? canonicalOnboardingInstrument(row, "etf") : null;
  }
  const [row] = await db.select(stockFields).from(etfHoldings).innerJoin(etfMasters, eq(etfMasters.id, etfHoldings.etfMasterId))
    .where(and(stockAdmission(), eq(etfHoldings.id, selection.id))).limit(1);
  return row ? canonicalOnboardingInstrument(row, "stock") : null;
}
