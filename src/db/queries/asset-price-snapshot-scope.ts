import "server-only";

import { and, eq, or, sql, type SQL } from "drizzle-orm";

import { assetPriceSnapshots } from "@/db/schema";
import {
  normalizePriceInstrumentIdentity,
  priceInstrumentKey,
  type PriceInstrumentIdentityInput,
} from "@/lib/market-data/price-instrument-identity";

export function assetPriceSnapshotInstrumentCondition(
  instruments: readonly PriceInstrumentIdentityInput[],
): SQL {
  const uniqueInstruments = new Map(
    instruments.flatMap((instrument) => {
      const normalized = normalizePriceInstrumentIdentity(instrument);
      const key = normalized ? priceInstrumentKey(normalized) : null;
      return normalized && key ? [[key, normalized] as const] : [];
    }),
  );
  const conditions = [...uniqueInstruments.values()].map((instrument) =>
    and(
      eq(
        sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
        instrument.market,
      ),
      eq(
        sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
        instrument.currency,
      ),
      eq(
        sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
        instrument.ticker,
      ),
    ),
  );

  if (conditions.length === 0) return sql`false`;
  if (conditions.length === 1) return conditions[0]!;
  return or(...conditions)!;
}
