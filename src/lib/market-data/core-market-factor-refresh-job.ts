import "server-only";

import { asc, inArray, max } from "drizzle-orm";

import { db } from "@/db/client";
import { globalMarketFactors } from "@/db/schema";
import { buildCoreMarketFactorRows } from "@/lib/market-data/core-market-factor-metrics";
import {
  CORE_MARKET_FACTOR_DEFINITIONS,
  CORE_MARKET_FACTOR_REFRESH_POLICY,
} from "@/lib/market-data/core-market-factor-policy";
import { fetchCoreMarketFactorSources } from "@/lib/market-data/core-market-factor-source";

export async function runCoreMarketFactorRefreshJob({
  dryRun = true,
  now = new Date(),
}: {
  dryRun?: boolean;
  now?: Date;
} = {}) {
  const endDate = now.toISOString().slice(0, 10);
  const latestRows = await db
    .select({
      factorKey: globalMarketFactors.factorKey,
      latestDate: max(globalMarketFactors.factorDate),
    })
    .from(globalMarketFactors)
    .where(
      inArray(
        globalMarketFactors.factorKey,
        CORE_MARKET_FACTOR_DEFINITIONS.map((row) => row.factorKey),
      ),
    )
    .groupBy(globalMarketFactors.factorKey)
    .orderBy(asc(globalMarketFactors.factorKey));
  const latestByKey = new Map(
    latestRows.map((row) => [row.factorKey, row.latestDate]),
  );
  const writeFromByKey = new Map(
    CORE_MARKET_FACTOR_DEFINITIONS.map((definition) => {
      const latest = latestByKey.get(definition.factorKey);
      return [
        definition.factorKey,
        latest
          ? shiftDate(latest, 1)
          : shiftDate(
              endDate,
              -CORE_MARKET_FACTOR_REFRESH_POLICY.emptySeriesBackfillCalendarDays,
            ),
      ] as const;
    }),
  );
  const earliestWriteFrom = [...writeFromByKey.values()].sort()[0];
  const fetchFromDate = shiftDate(
    earliestWriteFrom,
    -CORE_MARKET_FACTOR_REFRESH_POLICY.sourceLookbackCalendarDays,
  );
  const source = await fetchCoreMarketFactorSources({
    fromDate: fetchFromDate,
    toDate: endDate,
  });
  const candidates = CORE_MARKET_FACTOR_DEFINITIONS.flatMap((definition) =>
    buildCoreMarketFactorRows({
      definition,
      observations: source.series.get(definition.factorKey) ?? [],
      observedAt: now,
      writeFromDate: writeFromByKey.get(definition.factorKey)!,
    }),
  );

  let insertedCount = 0;
  if (!dryRun) {
    for (const chunk of chunks(candidates, 200)) {
      const inserted = await db
        .insert(globalMarketFactors)
        .values(chunk)
        .onConflictDoNothing({
          target: [
            globalMarketFactors.factorKey,
            globalMarketFactors.factorDate,
          ],
        })
        .returning({ id: globalMarketFactors.id });
      insertedCount += inserted.length;
    }
  }

  return Object.freeze({
    ok: true,
    dryRun,
    writesEnabled: !dryRun,
    policy: CORE_MARKET_FACTOR_REFRESH_POLICY,
    providerCallCount: source.providerCallCount,
    fetchFromDate,
    endDate,
    candidateCount: candidates.length,
    insertedCount,
    skippedCount: dryRun ? 0 : candidates.length - insertedCount,
    latestCandidateDate:
      candidates.map((row) => row.factorDate).sort().at(-1) ?? null,
    series: Object.freeze(
      CORE_MARKET_FACTOR_DEFINITIONS.map((definition) => {
        const rows = candidates.filter(
          (row) => row.factorKey === definition.factorKey,
        );
        return Object.freeze({
          factorKey: definition.factorKey,
          writeFromDate: writeFromByKey.get(definition.factorKey)!,
          candidateCount: rows.length,
          latestCandidateDate: rows.at(-1)?.factorDate ?? null,
        });
      }),
    ),
  });
}

function chunks<T>(rows: readonly T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

function shiftDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
