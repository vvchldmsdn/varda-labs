import "server-only";

import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { assetPriceSnapshots } from "@/db/schema";
import {
  buildRawPriceHistoryReadModel,
  normalizeRawPriceHistoryRequest,
  type RawPriceHistoryRequest,
} from "@/lib/market-data/raw-price-history";

export async function getReadOnlyRawPriceHistory(
  input: RawPriceHistoryRequest,
) {
  const request = normalizeRawPriceHistoryRequest(input);
  const tickers = [
    ...new Set(request.instruments.map(({ ticker }) => ticker)),
  ];
  const rows = await db
    .select({
      market: sql<string>`lower(trim(${assetPriceSnapshots.market}))`,
      currency: sql<string>`upper(trim(${assetPriceSnapshots.currency}))`,
      ticker: sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
      priceDate: assetPriceSnapshots.priceDate,
      closePrice: assetPriceSnapshots.closePrice,
      source: assetPriceSnapshots.source,
      providerSymbol: assetPriceSnapshots.providerSymbol,
      providerExchange: assetPriceSnapshots.providerExchange,
      fetchedAt: assetPriceSnapshots.fetchedAt,
    })
    .from(assetPriceSnapshots)
    .where(
      and(
        inArray(
          sql<string>`upper(trim(${assetPriceSnapshots.ticker}))`,
          tickers,
        ),
        gte(assetPriceSnapshots.priceDate, request.startDate),
        lte(assetPriceSnapshots.priceDate, request.endDate),
        eq(assetPriceSnapshots.isSample, false),
      ),
    )
    .orderBy(
      asc(assetPriceSnapshots.priceDate),
      asc(assetPriceSnapshots.market),
      asc(assetPriceSnapshots.currency),
      asc(assetPriceSnapshots.ticker),
    );

  return buildRawPriceHistoryReadModel({ request, rows });
}
