import { isKrxGoldManualAssetCandidate, MANUAL_ASSET_PRICE_POLICY, parseManualAssetPriceInput } from "./manual-asset-price.ts";
import { Decimal } from "../money.ts";
import type { ValuationObservation } from "../currency-valuation.ts";

type Holding = {
  id: string; accountId: string; canonicalOwnerUserId: string | null; account: string;
  name: string; assetType: string | null; ticker: string | null; currency: string; market: string;
  quantity: string; currentPrice: string; fractionalKrwValue: string | null;
  priceSource: string | null; priceQuoteType: string | null; priceStatus: string | null;
  priceAsOf: Date | null; priceFetchedAt: Date | null;
};
type SavedPosition = {
  assetId: string | null; accountId: string | null; canonicalOwnerUserId: string | null;
  source: string | null; priceSource: string | null; priceBasis: string | null;
  currentPrice: string | null; quantity: string | null; marketValueKrw: string | null;
  capturedAt: Date | null; currency: string | null; isSample: boolean;
};

/** The gold contract carries the owner's stored KRW/g valuation forward. Older imports
 * have no input timestamp. Admit those only when the same owned holding, unit price,
 * quantity and amount are corroborated by a saved manual valuation. */
export function currentManualGold(holding: Holding, latest: readonly SavedPosition[], now: Date): ValuationObservation | null {
  if (!holding.canonicalOwnerUserId || !isKrxGoldManualAssetCandidate({ ...holding, accountCode: holding.account }) ||
      !parseManualAssetPriceInput(holding.currentPrice).ok || Decimal.from(holding.quantity).compare(0) <= 0 ||
      Decimal.from(holding.fractionalKrwValue ?? 0).compare(0) !== 0) return null;
  let recordedAt = holding.priceAsOf;
  let source: string = MANUAL_ASSET_PRICE_POLICY.source;
  if (holding.priceSource !== source || holding.priceQuoteType !== MANUAL_ASSET_PRICE_POLICY.quoteType || holding.priceStatus !== MANUAL_ASSET_PRICE_POLICY.status) {
    if (holding.priceSource || holding.priceAsOf || holding.priceFetchedAt || holding.priceQuoteType || holding.priceStatus) return null;
    const matches = latest.filter(row => row.assetId === holding.id && row.accountId === holding.accountId && row.canonicalOwnerUserId === holding.canonicalOwnerUserId && !row.isSample);
    const row = matches[0];
    if (matches.length !== 1 || row.currency !== "KRW" || row.source !== "varda_manual_daily_snapshot" ||
        row.priceSource !== "asset_current_price" || row.priceBasis !== "manual_current" ||
        !row.currentPrice || !row.quantity || !row.marketValueKrw ||
        Decimal.from(holding.currentPrice).compare(row.currentPrice) !== 0 || Decimal.from(holding.quantity).compare(row.quantity) !== 0 ||
        Decimal.from(row.quantity).mul(row.currentPrice).compare(row.marketValueKrw) !== 0) return null;
    recordedAt = row.capturedAt;
    source = "stored_manual_snapshot";
  }
  if (!recordedAt || !Number.isFinite(recordedAt.getTime()) || recordedAt > now) return null;
  return {
    quantity: holding.quantity, price: holding.currentPrice, currency: "KRW", at: now.toISOString(), basis: "raw", source,
    timestampBasis: "stored_valuation", manualRecordedAt: recordedAt.toISOString(),
    priceReferenceDate: new Intl.DateTimeFormat("en-CA", {timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).format(recordedAt),
  };
}
