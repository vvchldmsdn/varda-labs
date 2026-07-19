export const MANUAL_ASSET_PRICE_POLICY = Object.freeze({
  version: "manual_asset_price_v1",
  source: "manual_entry",
  quoteType: "manual_valuation",
  status: "stored_manual",
  carryPolicy: "retain_until_next_manual_update",
  historyPolicy: "forward_only_no_backcast",
} as const);

export function buildManualAssetPriceUpdate(input: {
  currentPrice: string;
  recordedAt: Date;
}) {
  const recordedAtMs = input.recordedAt.getTime();
  if (!Number.isFinite(recordedAtMs)) {
    throw new TypeError("recordedAt must be a valid Date");
  }

  return Object.freeze({
    currentPrice: input.currentPrice,
    priceSource: MANUAL_ASSET_PRICE_POLICY.source,
    priceFetchedAt: null,
    priceAsOf: new Date(recordedAtMs),
    priceQuoteType: MANUAL_ASSET_PRICE_POLICY.quoteType,
    priceStatus: MANUAL_ASSET_PRICE_POLICY.status,
    priceError: null,
  });
}
