import { Decimal, isCurrency, type Currency } from './money.ts';
import { nativeDateOnlyAt } from './native-portfolio-ledger.ts';
import { nativeLedgerLocalTime } from './native-ledger-clock.ts';
import { tradePhotoDate, tradePhotoNumber, type TradePhotoCandidate } from './trade-photo.ts';

export type TradePhotoFillHolding = { id: string; name: string; ticker?: string | null; currency: string; archived?: boolean };
export type ExistingPhotoFillTrade = { assetId: string; side: 'buy' | 'sell'; date: string; quantity: string; price?: string; executionTotal?: string };
export type TradePhotoFillReview = {
  label: string; assetId: string; side: 'buy' | 'sell'; date: string; time: string;
  quantity: string; price: string; executionTotal: string; currency: Currency | '';
  mode: 'execution' | 'execution_total'; verified: boolean;
};
export type TradePhotoFillApplication = {
  assetId: string; side: 'buy' | 'sell'; fields: {
    quantity: string; price: string; executionTotal: string; currency: Currency;
    inputMode: 'execution' | 'execution_total'; executionInputMode: 'execution' | 'execution_total';
    timePrecision: 'date_only' | 'exact'; tradeDate: string; at: string;
  };
};
export type TradePhotoFillIssue = { field: 'assetId' | 'side' | 'date' | 'time' | 'quantity' | 'price' | 'executionTotal' | 'currency' | 'verified'; reason: 'holding' | 'side' | 'date' | 'time' | 'future' | 'quantity' | 'amount' | 'currency' | 'currency_mismatch' | 'duplicate' | 'review' };
const normalized = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');

/** A navigation selection is not evidence of the pictured instrument. Only an
 * exact, unique name or ticker match can preselect a holding in this account. */
export function matchedPhotoHolding(label: string, holdings: readonly TradePhotoFillHolding[]): string {
  const labels = [label, ...label.split(/\s+[·•]\s+/)].map(normalized).filter(Boolean);
  const matches = holdings.filter(holding => labels.includes(normalized(holding.name)) || !!holding.ticker && labels.includes(normalized(holding.ticker)));
  return matches.length === 1 ? matches[0].id : '';
}

export function photoFillReview(candidate: TradePhotoCandidate, holdings: readonly TradePhotoFillHolding[]): TradePhotoFillReview {
  return { label: candidate.label, assetId: matchedPhotoHolding(candidate.label, holdings), side: candidate.side,
    date: candidate.date, time: '', quantity: candidate.quantity,
    // A reported total is exact evidence; a derived average may be recurring.
    price: candidate.priceSource === 'reported' ? candidate.price : '', executionTotal: candidate.gross,
    currency: candidate.currency, mode: candidate.priceSource === 'reported' && candidate.price ? 'execution' : candidate.gross ? 'execution_total' : 'execution', verified: false };
}

export function photoFillNeedsTime(date: string, serverNow?: string): boolean {
  if (tradePhotoDate(date) !== date || !date || !serverNow || !Number.isFinite(Date.parse(serverNow))) return false;
  return Date.parse(nativeDateOnlyAt(date)) > Date.parse(serverNow);
}

function fillTotal(row: { quantity: string; price?: string; executionTotal?: string }): Decimal | null {
  try {
    const total = row.executionTotal && tradePhotoNumber(row.executionTotal);
    if (total) return Decimal.from(total);
    const price = row.price && tradePhotoNumber(row.price), quantity = tradePhotoNumber(row.quantity, 6);
    if (price && quantity) return Decimal.from(quantity).mul(price);
  } catch { /* Incomplete records cannot establish an exact duplicate. */ }
  return null;
}

export function photoFillDuplicate(review: TradePhotoFillReview, existing: readonly ExistingPhotoFillTrade[]): boolean {
  const total = fillTotal({ quantity: review.quantity, ...(review.mode === 'execution' ? { price: review.price } : { executionTotal: review.executionTotal }) });
  const quantity = tradePhotoNumber(review.quantity, 6);
  if (!total || !review.assetId || !quantity) return false;
  return existing.some(row => {
    const previousQuantity = tradePhotoNumber(row.quantity, 6);
    if (row.assetId !== review.assetId || row.side !== review.side || row.date !== review.date || !previousQuantity) return false;
    const previous = fillTotal(row);
    return !!previous && Decimal.from(previousQuantity).compare(quantity) === 0 && previous.compare(total) === 0;
  });
}

/** Produces editable fields only. It never saves, creates an operation id, infers
 * settlement/fees, or converts an opening balance into a new transaction. */
export function preparePhotoFill(review: TradePhotoFillReview, holdings: readonly TradePhotoFillHolding[], existing: readonly ExistingPhotoFillTrade[] = [], serverNow?: string): { ok: true; value: TradePhotoFillApplication } | { ok: false; issue: TradePhotoFillIssue } {
  const invalid = (field: TradePhotoFillIssue['field'], reason: TradePhotoFillIssue['reason']) => ({ ok: false as const, issue: { field, reason } });
  const holding = holdings.find(row => row.id === review.assetId);
  if (!holding) return invalid('assetId', 'holding');
  if (review.side !== 'buy' && review.side !== 'sell') return invalid('side', 'side');
  if (!isCurrency(review.currency)) return invalid('currency', 'currency');
  if (holding.currency !== review.currency) return invalid('currency', 'currency_mismatch');
  if (!review.date || tradePhotoDate(review.date) !== review.date) return invalid('date', 'date');
  const precise = !!review.time || photoFillNeedsTime(review.date, serverNow);
  let at = '';
  if (precise) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(review.time)) return invalid('time', 'time');
    const when = Date.parse(`${review.date}T${review.time.length === 5 ? review.time + ':00' : review.time}+09:00`);
    if (serverNow && Number.isFinite(Date.parse(serverNow)) && when > Date.parse(serverNow)) return invalid('time', 'future');
    at = nativeLedgerLocalTime(when);
  }
  const quantity = tradePhotoNumber(review.quantity, 6);
  if (!quantity) return invalid('quantity', 'quantity');
  const field = review.mode === 'execution_total' ? 'executionTotal' : 'price';
  const amount = tradePhotoNumber(review[field]);
  if (!amount) return invalid(field, 'amount');
  if (photoFillDuplicate(review, existing)) return invalid('verified', 'duplicate');
  if (!review.verified) return invalid('verified', 'review');
  return { ok: true, value: { assetId: holding.id, side: review.side, fields: {
    quantity, price: field === 'price' ? amount : '', executionTotal: field === 'executionTotal' ? amount : '', currency: review.currency,
    inputMode: review.mode, executionInputMode: review.mode, timePrecision: precise ? 'exact' : 'date_only', tradeDate: review.date, at,
  } } };
}
