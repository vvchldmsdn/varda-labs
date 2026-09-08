import "server-only";

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { fxRates } from "@/db/schema";
import { selectUsableFxRows } from "@/lib/market-data/fx-rate-admission";

/** Shared market evidence only; tenant settings remain a caller-scoped fallback. */
export async function loadUsablePortfolioFxRows(limit: number) {
  const rows = await db.select().from(fxRates)
    .where(and(
      eq(fxRates.isSample, false),
      eq(sql<string>`lower(trim(${fxRates.status}))`, "ok"),
      sql`${fxRates.usdKrw} > 0`,
      sql`${fxRates.usdKrw} < 'Infinity'::numeric`,
    ))
    .orderBy(desc(fxRates.rateDate), sql`${fxRates.fetchedAt} desc nulls last`, desc(fxRates.createdAt))
    .limit(limit);
  return selectUsableFxRows(rows);
}
