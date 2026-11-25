import "server-only";

import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fxRates } from "@/db/schema";
import { selectUsableFxRows } from "@/lib/market-data/fx-rate-admission";
import { CURRENT_VALUATION_FX_MAX_AGE_MS } from "@/lib/market-data/current-valuation-fx";

/** Shared market evidence only; tenant settings remain a caller-scoped fallback. */
export async function loadUsablePortfolioFxRows(limit: number, valuation?: { asOf: Date; includeHistory: boolean }) {
  const current = valuation && and(
    gte(fxRates.observedAt, new Date(valuation.asOf.getTime() - CURRENT_VALUATION_FX_MAX_AGE_MS)),
    lte(fxRates.observedAt, fxRates.fetchedAt),
    lte(fxRates.fetchedAt, valuation.asOf),
    inArray(fxRates.rateKind, ["spot", "daily_reference"]),
    sql`trim(${fxRates.source}) <> ''`,
  );
  // Always reserve the first slots for current valuation evidence. Home also
  // uses the remaining history for its FX trend. Filter before the row limit.
  const currentFirst = current ? [sql`case when ${current} then ${fxRates.observedAt} end desc nulls last`] : [];
  const rows = await db.select().from(fxRates)
    .where(and(
      valuation?.includeHistory ? undefined : current,
      eq(fxRates.isSample, false),
      eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
      sql`${fxRates.usdKrw} > 0`,
      sql`${fxRates.usdKrw} < 'Infinity'::numeric`,
    ))
    .orderBy(...currentFirst, desc(fxRates.rateDate), sql`${fxRates.fetchedAt} desc nulls last`, desc(fxRates.createdAt), desc(fxRates.id))
    .limit(limit);
  return selectUsableFxRows(rows);
}
