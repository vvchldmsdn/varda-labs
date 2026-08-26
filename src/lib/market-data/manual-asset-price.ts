export const MANUAL_ASSET_PRICE_POLICY = Object.freeze({
  version: "manual_asset_price_v1",
  source: "manual_entry",
  quoteType: "manual_valuation",
  status: "stored_manual",
  carryPolicy: "retain_until_next_manual_update",
  historyPolicy: "forward_only_no_backcast",
} as const);

export const KRX_GOLD_MANUAL_ASSET_BINDING = Object.freeze({
  version: "krx_gold_manual_asset_binding_v1",
  account: "brokerage",
  name: "금현물",
  ticker: null,
  assetType: "commodity",
  market: "korea",
  currency: "KRW",
  quoteUnit: "KRW_PER_G",
  minimumPriceKrwPerG: 1,
  maximumPriceKrwPerG: 100_000_000,
} as const);

export type ManualAssetPriceInputResult =
  | Readonly<{ ok: true; currentPrice: string }>
  | Readonly<{ ok: false; reason: "invalid_price" | "price_out_of_range" }>;

export type ManualKrxGoldPriceActionState = Readonly<{
  status: "idle" | "success" | "invalid" | "unauthorized" | "conflict" | "error";
  message: string | null;
}>;

type KrxGoldManualInstrumentCandidate = Readonly<{
  name?: string | null;
  ticker?: string | null;
  assetType?: string | null;
  market?: string | null;
  currency?: string | null;
}>;

export function parseManualAssetPriceInput(
  input: unknown,
): ManualAssetPriceInputResult {
  const currentPrice = typeof input === "string" ? input.trim() : "";
  if (!/^(?:0|[1-9]\d{0,8})(?:\.\d{1,4})?$/.test(currentPrice)) {
    return Object.freeze({ ok: false, reason: "invalid_price" });
  }

  const numericPrice = Number(currentPrice);
  if (
    !Number.isFinite(numericPrice) ||
    numericPrice < KRX_GOLD_MANUAL_ASSET_BINDING.minimumPriceKrwPerG ||
    numericPrice > KRX_GOLD_MANUAL_ASSET_BINDING.maximumPriceKrwPerG
  ) {
    return Object.freeze({ ok: false, reason: "price_out_of_range" });
  }

  return Object.freeze({ ok: true, currentPrice });
}

export function isKrxGoldManualAssetCandidate(input: {
  accountCode?: string | null;
  name?: string | null;
  ticker?: string | null;
  assetType?: string | null;
  market?: string | null;
  currency?: string | null;
}) {
  return (
    input.accountCode === KRX_GOLD_MANUAL_ASSET_BINDING.account &&
    isKrxGoldManualInstrumentCandidate(input)
  );
}

export function isKrxGoldManualInstrumentCandidate(
  input: KrxGoldManualInstrumentCandidate,
) {
  return (
    input.name === KRX_GOLD_MANUAL_ASSET_BINDING.name &&
    input.ticker === KRX_GOLD_MANUAL_ASSET_BINDING.ticker &&
    input.assetType === KRX_GOLD_MANUAL_ASSET_BINDING.assetType &&
    input.market === KRX_GOLD_MANUAL_ASSET_BINDING.market &&
    input.currency === KRX_GOLD_MANUAL_ASSET_BINDING.currency
  );
}

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
