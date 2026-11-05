import type { ExistingPhotoFillTrade } from './trade-photo-fill';

type RecordedTrade = { accountId: string; event: {
  type: string; at: string; assetId?: string; quantity?: string; currency?: string;
  price?: string; executionTotal?: { amount: string; currency: string };
  executionUnitPrice?: { amount: string; currency: string };
  dateEvidence?: { reportedDate: string };
} };

/** Compare only this authenticated account's known execution evidence. Cash
 * settlement amounts in another currency are not execution consideration. */
export function existingPhotoFillTrades(trades: readonly RecordedTrade[], accountId: string): ExistingPhotoFillTrade[] {
  return trades.flatMap(({ accountId: owner, event }) => {
    if (owner !== accountId || !['buy', 'sell'].includes(event.type) || !event.assetId || !event.quantity || !Number.isFinite(Date.parse(event.at))) return [];
    return [{ assetId: event.assetId, side: event.type as 'buy' | 'sell',
      date: event.dateEvidence?.reportedDate ?? new Date(Date.parse(event.at) + 9 * 3600000).toISOString().slice(0, 10),
      quantity: event.quantity,
      price: event.price ?? (event.executionUnitPrice?.currency === event.currency ? event.executionUnitPrice?.amount : undefined),
      executionTotal: event.executionTotal?.currency === event.currency ? event.executionTotal?.amount : undefined,
    }];
  });
}
