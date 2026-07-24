import "server-only";

import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db/client";
import { globalMarketFactors } from "@/db/schema";
import { SIMULATION_REGIME_FACTOR_DEFINITIONS } from "@/lib/simulation-regime-bootstrap-policy";

export const REGIME_RESEARCH_CANDIDATES = Object.freeze([
  Object.freeze({
    displayName: "KODEX 200",
    market: "korea",
    currency: "KRW" as const,
    ticker: "069500",
  }),
  Object.freeze({
    displayName: "Vanguard S&P 500 ETF",
    market: "us",
    currency: "USD" as const,
    ticker: "VOO",
  }),
]);

export const loadRegimeFactorRows = cache(
  async (endServiceDate: string) => {
    const factorKeys = SIMULATION_REGIME_FACTOR_DEFINITIONS.map(
      (definition) => definition.factorKey,
    );
    return db
      .select({
        factorKey: globalMarketFactors.factorKey,
        factorDate: globalMarketFactors.factorDate,
        periodEndDate: globalMarketFactors.periodEndDate,
        releaseDate: globalMarketFactors.releaseDate,
        value: globalMarketFactors.value,
        volatility20dPct: globalMarketFactors.volatility20dPct,
      })
      .from(globalMarketFactors)
      .where(
        and(
          inArray(globalMarketFactors.factorKey, factorKeys),
          lte(globalMarketFactors.releaseDate, endServiceDate),
          eq(globalMarketFactors.isSample, false),
          eq(globalMarketFactors.isPreliminary, false),
        ),
      )
      .orderBy(
        asc(globalMarketFactors.factorKey),
        asc(globalMarketFactors.releaseDate),
        asc(globalMarketFactors.factorDate),
      );
  },
);
