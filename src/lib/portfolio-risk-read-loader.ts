import { normalizeCurrencyCode, normalizeTicker, uniqueStrings } from "./portfolio-math.ts";
import { shiftRiskDate } from "./portfolio-risk-calendar.ts";
import {
  composePortfolioRiskReadModel,
  PORTFOLIO_RISK_READ_POLICY,
} from "./portfolio-risk-read-model.ts";
import { PORTFOLIO_RISK_BENCHMARKS } from "./portfolio-risk-path-analytics.ts";
import type {
  PortfolioRiskAccount,
  PortfolioRiskReadRepository,
  PortfolioRiskWindow,
} from "./portfolio-risk-read-model-types.ts";
import { resolveSnapshotCycle } from "./snapshots/market-calendar.ts";

const TRACKED_ACCOUNTS = ["brokerage", "isa", "irp"] as const;
const SUPPORTED_WINDOWS = [30, 90, 252] as const;

export type PortfolioRiskReadOptions = {
  account?: string | string[] | null;
  window?: string | string[] | number | null;
  now?: Date;
};

export type PreselectedPortfolioRiskReadOptions = Omit<
  PortfolioRiskReadOptions,
  "account"
>;

export async function loadPortfolioRiskReadModel(
  repository: PortfolioRiskReadRepository,
  options: PortfolioRiskReadOptions = {},
) {
  const selection = {
    account: normalizePortfolioRiskAccount(options.account),
    window: normalizePortfolioRiskWindow(options.window),
  };
  return loadPortfolioRiskReadModelWithSelection({
    assetSelection: "legacy_account_filter",
    repository,
    selection,
    now: options.now,
  });
}

export async function loadPreselectedPortfolioRiskReadModel(
  repository: PortfolioRiskReadRepository,
  options: PreselectedPortfolioRiskReadOptions = {},
) {
  return loadPortfolioRiskReadModelWithSelection({
    assetSelection: "preselected",
    repository,
    selection: {
      account: "all",
      window: normalizePortfolioRiskWindow(options.window),
    },
    now: options.now,
  });
}

async function loadPortfolioRiskReadModelWithSelection({
  assetSelection,
  repository,
  selection,
  now,
}: {
  assetSelection: "legacy_account_filter" | "preselected";
  repository: PortfolioRiskReadRepository;
  selection: {
    account: PortfolioRiskAccount;
    window: PortfolioRiskWindow;
  };
  now?: Date;
}) {
  const serviceCycleDate = resolveSnapshotCycle(now ?? new Date()).snapshotDate;
  const sourceDateTo = shiftRiskDate(serviceCycleDate, -1);
  const priceSourceDateFrom = shiftRiskDate(
    sourceDateTo,
    -(selection.window * 2 + 45),
  );
  const fxSourceDateFrom = shiftRiskDate(
    priceSourceDateFrom,
    -PORTFOLIO_RISK_READ_POLICY.maxFxCarryDays,
  );
  const assetRows = await repository.loadAssets(selection.account);
  const hasAssets = assetRows.length > 0;
  const tickers = uniqueStrings([
    ...assetRows
      .map((row) => normalizeTicker(row.ticker))
      .filter((ticker): ticker is string => Boolean(ticker)),
    ...(hasAssets
      ? PORTFOLIO_RISK_BENCHMARKS.map((benchmark) => benchmark.ticker)
      : []),
  ]);
  const requiresFx =
    hasAssets &&
    (assetRows.some(
      (row) => normalizeCurrencyCode(row.currency) === "USD",
    ) ||
      PORTFOLIO_RISK_BENCHMARKS.some(
        (benchmark) => benchmark.currency === "USD",
      ));

  const priceRowsPromise =
    tickers.length > 0
      ? repository.loadPrices({
          tickers,
          sourceDateFrom: priceSourceDateFrom,
          sourceDateTo,
        })
      : Promise.resolve([]);
  const fxRowsPromise = requiresFx
    ? repository.loadFxRates({
        sourceDateFrom: fxSourceDateFrom,
        sourceDateTo,
      })
    : Promise.resolve([]);
  const [priceRows, fxRows] = await Promise.all([
    priceRowsPromise,
    fxRowsPromise,
  ]);

  return composePortfolioRiskReadModel({
    assetSelection,
    selection,
    queryRange: {
      serviceCycleDate,
      priceSourceDateFrom,
      fxSourceDateFrom,
      sourceDateTo,
    },
    assetRows,
    priceRows,
    fxRows,
  });
}

export function normalizePortfolioRiskAccount(
  value: string | string[] | null | undefined,
): PortfolioRiskAccount {
  const raw = Array.isArray(value) ? value[0] : value;
  const normalized = raw?.trim().toLowerCase();
  return normalized === "all" ||
    TRACKED_ACCOUNTS.includes(normalized as (typeof TRACKED_ACCOUNTS)[number])
    ? (normalized as PortfolioRiskAccount)
    : "brokerage";
}

export function normalizePortfolioRiskWindow(
  value: string | string[] | number | null | undefined,
): PortfolioRiskWindow {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return SUPPORTED_WINDOWS.includes(parsed as PortfolioRiskWindow)
    ? (parsed as PortfolioRiskWindow)
    : 90;
}
