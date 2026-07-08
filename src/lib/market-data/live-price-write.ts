import type {
  LiveQuote,
  PriceLookupTarget,
} from "@/lib/market-data/providers/types";

export const LIVE_PRICE_WRITE_CONTRACT = {
  updates: [
    "assets.current_price",
    "assets.price_source",
    "assets.price_fetched_at",
    "assets.price_as_of",
    "assets.price_quote_type",
    "assets.price_status",
    "assets.price_error",
  ],
  inserts: [],
  snapshotWrites: false,
} as const;

export type LivePriceWritePolicy = "none" | "kis";

export type LivePriceWriteAction =
  | "planned_update"
  | "updated"
  | "skipped"
  | "failed";

export type LivePriceWriteResult = {
  ticker: string;
  source: string | null;
  action: LivePriceWriteAction;
  assetIds: string[];
  assetCount: number;
  updatedAssetCount: number;
  reason?: string;
};

export type LiveAssetUpdateValues = {
  currentPrice: string;
  priceSource: string;
  priceFetchedAt: Date;
  priceAsOf: Date;
  priceQuoteType: LiveQuote["quoteType"];
  priceStatus: "ok";
  priceError: null;
};

export function planLiveAssetPriceWrite(options: {
  row: LiveQuote;
  target: PriceLookupTarget | undefined;
  dryRun: boolean;
  allowWrite: boolean;
  writePolicy: LivePriceWritePolicy;
}): { result: LivePriceWriteResult; update: LiveAssetUpdateValues | null } {
  const assetIds = options.target?.assetIds ?? [];
  const baseResult = {
    ticker: options.row.ticker,
    source: options.row.source,
    assetIds,
    assetCount: assetIds.length,
    updatedAssetCount: 0,
  };
  const validationError = validateLiveQuoteRow(
    options.row,
    options.target,
    options.writePolicy,
  );

  if (validationError) {
    return {
      result: {
        ...baseResult,
        action: options.row.status === "error" ? "failed" : "skipped",
        reason: validationError,
      },
      update: null,
    };
  }

  if (options.dryRun) {
    return {
      result: {
        ...baseResult,
        action: "planned_update",
      },
      update: toLiveAssetUpdateValues(options.row),
    };
  }

  if (!options.allowWrite || options.writePolicy === "none") {
    return {
      result: {
        ...baseResult,
        action: "skipped",
        reason: "write_guard_not_satisfied",
      },
      update: null,
    };
  }

  return {
    result: {
      ...baseResult,
      action: "updated",
    },
    update: toLiveAssetUpdateValues(options.row),
  };
}

function validateLiveQuoteRow(
  row: LiveQuote,
  target: PriceLookupTarget | undefined,
  writePolicy: LivePriceWritePolicy,
) {
  if (row.status !== "ok") return row.error ?? `provider_status_${row.status}`;
  if (!target) return "target_not_found";
  if (target.assetIds.length === 0) return "target_has_no_assets";
  if (!isDecimalString(row.price)) return "invalid_live_price";
  if (!isAllowedLivePriceSource(row.source, writePolicy)) {
    return "unsupported_write_source";
  }
  return null;
}

function toLiveAssetUpdateValues(row: LiveQuote): LiveAssetUpdateValues {
  return {
    currentPrice: row.price ?? "0",
    priceSource: row.source,
    priceFetchedAt: row.fetchedAt,
    priceAsOf: row.priceAsOf ?? row.fetchedAt,
    priceQuoteType: row.quoteType,
    priceStatus: "ok",
    priceError: null,
  };
}

function isAllowedLivePriceSource(
  source: string | null,
  writePolicy: LivePriceWritePolicy,
) {
  if (writePolicy === "kis") {
    return (
      source === "kis_domestic_inquire_price" ||
      /^kis_overseas_price:[A-Z]+$/.test(source ?? "")
    );
  }

  return false;
}

function isDecimalString(value: string | null) {
  if (value === null) return false;
  return Number.isFinite(Number(value));
}
