import { normalizeTicker } from "./portfolio-math.ts";

export type TodayDetailSelectedAccount = "all" | "brokerage" | "isa" | "irp";

export type TodayHoldingDetailQuery = {
  ticker: string | null;
  market: string | null;
};

export type TodayHoldingDetailHolding = {
  name: string;
  ticker: string | null;
  account: string;
  market: string;
  currency: string;
  quantity: number;
  currentPrice: number;
  valueKrw: number;
  priceSource: string | null;
  priceFetchedAt: string | null;
  priceAsOf: string | null;
  priceQuoteType: string | null;
  priceStatus: string | null;
  dailyChangeKrw: number | null;
  dailyReturnPct: number | null;
  dailySource: string | null;
  previousCloseValueKrw: number | null;
  fxDailyChangeKrw: number | null;
};

export type TodayHoldingDetailContribution = {
  previousValueKrw: number;
  changeKrw: number;
  returnPct: number | null;
  tradeFlowKrw: number;
  fxChangeKrw: number;
  source: string;
};

export type TodayHoldingDetailExclusion = {
  subject: "holding" | "snapshot" | "aggregate";
  reason: string;
  source: string | null;
  ticker: string | null;
  assetName: string | null;
  account: string | null;
  currency: string | null;
  valueKrw: number | null;
};

export type TodayHoldingDetailResult =
  | {
      status: "empty";
      query: TodayHoldingDetailQuery;
    }
  | {
      status: "not_found";
      query: TodayHoldingDetailQuery;
    }
  | {
      status: "ambiguous";
      query: TodayHoldingDetailQuery;
      candidates: TodayHoldingDetailHolding[];
    }
  | {
      status: "selected";
      query: TodayHoldingDetailQuery;
      holding: TodayHoldingDetailHolding;
      contribution: TodayHoldingDetailContribution | null;
      exclusions: TodayHoldingDetailExclusion[];
    };

type DetailHoldingInput = TodayHoldingDetailHolding & {
  id: string;
};

type DetailContributionInput = TodayHoldingDetailContribution & {
  holdingId: string;
};

type DetailExclusionInput = TodayHoldingDetailExclusion & {
  holdingId: string | null;
  snapshotId: string | null;
};

type DetailDashboardInput = {
  selectedAccount: TodayDetailSelectedAccount;
  holdings: DetailHoldingInput[];
  todayMovement: {
    contributionRows: DetailContributionInput[];
    exclusions: DetailExclusionInput[];
  };
};

export function normalizeTodayHoldingDetailQuery(params: {
  ticker?: string | string[];
  market?: string | string[];
}): TodayHoldingDetailQuery {
  return {
    ticker: normalizeTicker(firstParam(params.ticker)),
    market: normalizeMarket(firstParam(params.market)),
  };
}

export function selectTodayHoldingDetail(
  data: DetailDashboardInput,
  query: TodayHoldingDetailQuery,
): TodayHoldingDetailResult {
  if (!query.ticker) {
    return { status: "empty", query };
  }

  const candidates = data.holdings.filter((holding) =>
    matchesHoldingSelector(holding, data.selectedAccount, query),
  );

  if (candidates.length === 0) {
    return { status: "not_found", query };
  }

  if (candidates.length > 1) {
    return {
      status: "ambiguous",
      query,
      candidates: candidates.map(sanitizeHolding),
    };
  }

  const holding = candidates[0];
  const contribution =
    data.todayMovement.contributionRows.find(
      (row) => row.holdingId === holding.id,
    ) ?? null;
  const exclusions = data.todayMovement.exclusions.filter((row) =>
    matchesExclusionForHolding(row, holding),
  );

  return {
    status: "selected",
    query,
    holding: sanitizeHolding(holding),
    contribution: contribution ? sanitizeContribution(contribution) : null,
    exclusions: exclusions.map(sanitizeExclusion),
  };
}

export function todayHoldingDetailHref(
  selectedAccount: TodayDetailSelectedAccount,
  holding: Pick<TodayHoldingDetailHolding, "ticker" | "market">,
) {
  const params = new URLSearchParams();
  if (selectedAccount !== "brokerage") params.set("account", selectedAccount);
  if (holding.ticker) params.set("ticker", normalizeTicker(holding.ticker) ?? "");
  if (holding.market) params.set("market", holding.market);
  const query = params.toString();
  return query ? `/today?${query}` : "/today";
}

function matchesHoldingSelector(
  holding: DetailHoldingInput,
  selectedAccount: TodayDetailSelectedAccount,
  query: TodayHoldingDetailQuery,
) {
  if (selectedAccount !== "all" && holding.account !== selectedAccount) {
    return false;
  }
  if (normalizeTicker(holding.ticker) !== query.ticker) return false;
  if (query.market && normalizeMarket(holding.market) !== query.market) {
    return false;
  }
  return true;
}

function matchesExclusionForHolding(
  exclusion: DetailExclusionInput,
  holding: DetailHoldingInput,
) {
  if (exclusion.subject === "aggregate") return true;
  if (exclusion.holdingId && exclusion.holdingId === holding.id) return true;
  if (exclusion.account && exclusion.account !== holding.account) return false;
  const exclusionTicker = normalizeTicker(exclusion.ticker);
  const holdingTicker = normalizeTicker(holding.ticker);
  if (exclusionTicker && holdingTicker && exclusionTicker === holdingTicker) {
    return true;
  }
  return Boolean(exclusion.assetName && exclusion.assetName === holding.name);
}

function sanitizeHolding(holding: DetailHoldingInput): TodayHoldingDetailHolding {
  return {
    name: holding.name,
    ticker: holding.ticker,
    account: holding.account,
    market: holding.market,
    currency: holding.currency,
    quantity: holding.quantity,
    currentPrice: holding.currentPrice,
    valueKrw: holding.valueKrw,
    priceSource: holding.priceSource,
    priceFetchedAt: holding.priceFetchedAt,
    priceAsOf: holding.priceAsOf,
    priceQuoteType: holding.priceQuoteType,
    priceStatus: holding.priceStatus,
    dailyChangeKrw: holding.dailyChangeKrw,
    dailyReturnPct: holding.dailyReturnPct,
    dailySource: holding.dailySource,
    previousCloseValueKrw: holding.previousCloseValueKrw,
    fxDailyChangeKrw: holding.fxDailyChangeKrw,
  };
}

function sanitizeContribution(
  row: DetailContributionInput,
): TodayHoldingDetailContribution {
  return {
    previousValueKrw: row.previousValueKrw,
    changeKrw: row.changeKrw,
    returnPct: row.returnPct,
    tradeFlowKrw: row.tradeFlowKrw,
    fxChangeKrw: row.fxChangeKrw,
    source: row.source,
  };
}

function sanitizeExclusion(row: DetailExclusionInput): TodayHoldingDetailExclusion {
  return {
    subject: row.subject,
    reason: row.reason,
    source: row.source,
    ticker: row.ticker,
    assetName: row.assetName,
    account: row.account,
    currency: row.currency,
    valueKrw: row.valueKrw,
  };
}

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeMarket(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
