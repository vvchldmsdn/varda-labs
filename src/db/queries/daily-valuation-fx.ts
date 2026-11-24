import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { dailyValuationFx } from "@/db/schema";
import { Decimal } from "@/lib/money";
import {
  ECB_VALUATION_POLICY,
  ECB_VALUATION_SOURCE,
  fetchEcbValuationFx,
} from "@/lib/market-data/ecb-valuation-fx";

export async function loadDailyValuationFx(serviceDate: string) {
  const [row] = await db
    .select()
    .from(dailyValuationFx)
    .where(
      and(
        eq(dailyValuationFx.serviceDate, serviceDate),
        eq(dailyValuationFx.baseCurrency, "USD"),
        eq(dailyValuationFx.quoteCurrency, "KRW"),
      ),
    )
    .limit(1);
  return row
    ? { ...row, cutoffAt: new Date(serviceDate + "T07:00:00+09:00") }
    : null;
}

/** One global write per service date. A retry reuses the original receipt. */
export async function ensureDailyValuationFx(serviceDate: string) {
  if (Date.now() < Date.parse(serviceDate + "T07:00:00+09:00"))
    throw new Error("valuation_fx_cycle_not_closed");
  const existing = await loadDailyValuationFx(serviceDate);
  if (existing) return existing;
  const fixing = await fetchEcbValuationFx(serviceDate);
  const pastCycle =
    fixing.fetchedAt.getTime() >=
    Date.parse(serviceDate + "T07:00:00+09:00") + 86_400_000;
  await db
    .insert(dailyValuationFx)
    .values({
      serviceDate,
      baseCurrency: "USD",
      quoteCurrency: "KRW",
      ...fixing,
      source: ECB_VALUATION_SOURCE,
      policy: ECB_VALUATION_POLICY,
      evidenceKind: pastCycle
        ? "historical_reconstruction"
        : "closing_reference",
    })
    .onConflictDoNothing({
      target: [
        dailyValuationFx.serviceDate,
        dailyValuationFx.baseCurrency,
        dailyValuationFx.quoteCurrency,
      ],
    });
  const stored = await loadDailyValuationFx(serviceDate);
  if (
    !stored ||
    stored.referenceDate !== fixing.referenceDate ||
    Decimal.from(stored.rate).compare(fixing.rate) !== 0 ||
    Decimal.from(stored.krwPerEur).compare(fixing.krwPerEur) !== 0 ||
    Decimal.from(stored.usdPerEur).compare(fixing.usdPerEur) !== 0
  ) {
    throw new Error("valuation_fx_concurrent_conflict");
  }
  return stored;
}

export type DailyValuationFx = NonNullable<
  Awaited<ReturnType<typeof loadDailyValuationFx>>
>;

/** Prioritize the snapshot retry window, then repair gaps from longer outages in bounded batches. */
export async function collectClosingValuationFx(serviceDate: string) {
  const midnight = Date.parse(serviceDate + "T00:00:00Z");
  const days = [0, 1, 2].map((offset) =>
    new Date(midnight - offset * 86_400_000).toISOString().slice(0, 10),
  );
  let gapScanFailed = false;
  try {
    const olderGaps = await db.execute<{ service_date: string }>(sql`
      with bounds as (select min(service_date) as first_day from daily_valuation_fx)
      select (bounds.first_day + g.offset_days)::text as service_date
      from bounds cross join lateral generate_series(0, ${serviceDate}::date - 3 - bounds.first_day) as g(offset_days)
      where not exists (select 1 from daily_valuation_fx fx where fx.service_date = bounds.first_day + g.offset_days)
      order by g.offset_days limit 2
    `);
    days.push(...olderGaps.rows.map((row) => row.service_date));
  } catch {
    gapScanFailed = true;
  }
  const results = await Promise.allSettled(days.map(ensureDailyValuationFx));
  return {
    serviceDate,
    referenceDate:
      results[0].status === "fulfilled" ? results[0].value.referenceDate : null,
    missingDates: days.filter(
      (_, index) => results[index].status === "rejected",
    ),
    gapScanFailed,
  };
}
