import type {
  LiveQuote,
  PriceLookupTarget,
} from "@/lib/market-data/providers/types";

export const LIVE_PRICE_WRITE_CONTRACT = {
  updates: ["live_price_quotes by market/ticker/provider"],
  inserts: ["live_price_quotes"],
  snapshotWrites: false,
} as const;

export type LivePriceWritePolicy = "none" | "kis";

export type LivePriceWriteAction =
  | "planned_upsert"
  | "inserted"
  | "updated"
  | "skipped"
  | "failed";

export type LivePriceWriteResult = {
  ticker: string;
  source: string | null;
  action: LivePriceWriteAction;
  assetIds: string[];
  assetCount: number;
  quoteCount: number;
  reason?: string;
};

export type LivePriceQuoteWriteValues = {
  ticker: string;
  market: string;
  currency: string;
  provider: string;
  price: string;
  source: string;
  priceAsOf: Date;
  fetchedAt: Date;
  priceQuoteType: LiveQuote["quoteType"];
  priceStatus: "ok";
  priceError: null;
};

export function planLiveAssetPriceWrite(options: {
  row: LiveQuote;
  target: PriceLookupTarget | undefined;
  provider: string;
  dryRun: boolean;
  allowWrite: boolean;
  writePolicy: LivePriceWritePolicy;
}): { result: LivePriceWriteResult; write: LivePriceQuoteWriteValues | null } {
  const assetIds = options.target?.assetIds ?? [];
  const baseResult = {
    ticker: options.row.ticker,
    source: options.row.source,
    assetIds,
    assetCount: assetIds.length,
    quoteCount: 0,
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
      write: null,
    };
  }

  if (options.dryRun) {
    return {
      result: {
        ...baseResult,
        action: "planned_upsert",
        quoteCount: 1,
      },
      write: toLivePriceQuoteWriteValues(options.row, options.provider),
    };
  }

  if (!options.allowWrite || options.writePolicy === "none") {
    return {
      result: {
        ...baseResult,
        action: "skipped",
        reason: "write_guard_not_satisfied",
      },
      write: null,
    };
  }

  return {
    result: {
      ...baseResult,
      action: "updated",
      quoteCount: 1,
    },
    write: toLivePriceQuoteWriteValues(options.row, options.provider),
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

function toLivePriceQuoteWriteValues(
  row: LiveQuote,
  provider: string,
): LivePriceQuoteWriteValues {
  return {
    ticker: row.ticker,
    market: row.market,
    currency: row.currency,
    provider,
    price: row.price ?? "0",
    source: row.source,
    priceAsOf: row.priceAsOf ?? row.fetchedAt,
    fetchedAt: row.fetchedAt,
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
