import {
  isTradingDayForAsset,
  isUsdListedAsset,
} from "../snapshots/market-calendar.ts";
import { normalizeTicker, toNumber } from "../portfolio-math.ts";

type MarketAsset = {
  market: string;
  currency: string;
};

type ValuationAsset = MarketAsset & {
  id: string;
  legacyBase44Id: string | null;
  account: string;
  ticker: string | null;
  name: string;
  currentPrice: string | number;
};

type BaselinePosition = {
  account: string | null;
  assetId: string | null;
  legacyAssetId: string | null;
  ticker: string | null;
  assetName: string | null;
  unitPrice: string | number | null;
  closePrice: string | number | null;
  currentPrice: string | number | null;
  capturedAt?: Date | string | null;
};

type MarketSessionPolicy = {
  timeZone: string;
  openMinute: number;
};

const KOREA_SESSION: MarketSessionPolicy = {
  timeZone: "Asia/Seoul",
  openMinute: 9 * 60,
};

const US_SESSION: MarketSessionPolicy = {
  timeZone: "America/New_York",
  openMinute: 9 * 60 + 30,
};

export type SessionAwareValuationPrice = {
  price: number;
  basis: "current" | "market_closed_snapshot";
  basisAsOf: Date | string | null;
};

export function resolveSessionAwareValuationPrice({
  asset,
  baselinePositions,
  evaluatedAt,
  liveWindowStartAt,
}: {
  asset: ValuationAsset;
  baselinePositions: readonly BaselinePosition[];
  evaluatedAt: Date;
  liveWindowStartAt: Date;
}): SessionAwareValuationPrice {
  const currentPrice = toNumber(asset.currentPrice) ?? 0;
  if (
    shouldAdmitLiveLocalPrice({
      asset,
      evaluatedAt,
      liveWindowStartAt,
    })
  ) {
    return { price: currentPrice, basis: "current", basisAsOf: null };
  }

  const baseline = baselinePositions.find((position) =>
    baselinePositionMatchesAsset(position, asset),
  );
  const baselinePrice = baseline ? positionPrice(baseline) : null;

  return baselinePrice !== null && baselinePrice > 0
    ? {
        price: baselinePrice,
        basis: "market_closed_snapshot",
        basisAsOf: baseline?.capturedAt ?? null,
      }
    : { price: currentPrice, basis: "current", basisAsOf: null };
}

export function shouldAdmitLiveLocalPrice({
  asset,
  evaluatedAt,
  liveWindowStartAt,
}: {
  asset: MarketAsset;
  evaluatedAt: Date;
  liveWindowStartAt: Date;
}) {
  const policy = marketSessionPolicy(asset);
  if (!policy) return true;

  const serviceDate = zonedDateAndMinute(
    liveWindowStartAt,
    "Asia/Seoul",
  ).date;
  if (!isTradingDayForAsset(asset, serviceDate)) return false;

  const localEvaluation = zonedDateAndMinute(evaluatedAt, policy.timeZone);
  if (localEvaluation.date !== serviceDate) {
    return localEvaluation.date > serviceDate;
  }
  return localEvaluation.minute >= policy.openMinute;
}

function marketSessionPolicy(asset: MarketAsset) {
  if (isUsdListedAsset(asset)) return US_SESSION;
  if (asset.market === "korea") return KOREA_SESSION;
  return null;
}

function baselinePositionMatchesAsset(
  position: BaselinePosition,
  asset: ValuationAsset,
) {
  if (position.account !== asset.account) return false;
  if (position.assetId && position.assetId === asset.id) return true;
  if (
    position.legacyAssetId &&
    asset.legacyBase44Id &&
    position.legacyAssetId === asset.legacyBase44Id
  ) {
    return true;
  }
  const assetTicker = normalizeTicker(asset.ticker);
  if (assetTicker && normalizeTicker(position.ticker) === assetTicker) return true;
  return position.assetName === asset.name;
}

function positionPrice(position: BaselinePosition) {
  return (
    toNumber(position.unitPrice) ??
    toNumber(position.closePrice) ??
    toNumber(position.currentPrice)
  );
}

function zonedDateAndMinute(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const fields = new Map(parts.map((part) => [part.type, part.value]));
  const date = `${fields.get("year")}-${fields.get("month")}-${fields.get("day")}`;
  const hour = Number(fields.get("hour"));
  const minute = Number(fields.get("minute"));

  return {
    date,
    minute: hour * 60 + minute,
  };
}
