import { riskCalendarDayDistance } from "./portfolio-risk-calendar.ts";

type NumericInput = number | string | null | undefined;

export const INVESTMENT_LAB_STRESS_REPLAY_POLICY = Object.freeze({
  version: "investment_lab_stress_replay_v1",
  holdingWeightBasis: "current_value_renormalized_over_eligible_instruments",
  pathModel: "gross_buy_and_hold_without_rebalancing",
  priceCarryCalendarDays: 7,
  fxCarryCalendarDays: 5,
  missingHistory: "exclude_instrument_and_disclose_current_value_coverage",
  recommendationAuthority: "research_only_not_a_recommendation",
} as const);

export const INVESTMENT_LAB_STRESS_WINDOWS = Object.freeze([
  Object.freeze({
    id: "covid_selloff",
    label: "코로나 급락",
    startDate: "2020-02-19",
    endDate: "2020-03-23",
    description: "글로벌 주식시장의 코로나19 급락 구간",
  }),
  Object.freeze({
    id: "rate_shock_2022",
    label: "2022 금리 충격",
    startDate: "2022-01-03",
    endDate: "2022-10-14",
    description: "빠른 금리 인상과 성장주 조정이 겹친 구간",
  }),
  Object.freeze({
    id: "ai_rally_2023",
    label: "2023 AI 상승",
    startDate: "2023-01-03",
    endDate: "2023-07-31",
    description: "미국 대형 기술주 중심의 AI 랠리 구간",
  }),
] as const);

export type InvestmentLabStressWindowDefinition = Readonly<{
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  description: string;
}>;

export type InvestmentLabStressHoldingInput = Readonly<{
  name: string;
  ticker: string | null;
  account: string;
  market: string;
  currency: string;
  currentValueKrw: NumericInput;
}>;

export type InvestmentLabStressPriceInput = Readonly<{
  ticker: string;
  market: string;
  currency: string;
  priceDate: string;
  closePrice: NumericInput;
  priceBasis: "provider_adjusted_close" | "private_kis_raw_close";
}>;

export type InvestmentLabStressFxInput = Readonly<{
  rateDate: string;
  usdKrw: NumericInput;
  status?: string | null;
}>;

export type InvestmentLabStressReplayStrategyId =
  | "current_composition"
  | "equal_weight"
  | "kodex200"
  | "voo"
  | "cash";

export type InvestmentLabStressReplayStrategy = Readonly<{
  id: InvestmentLabStressReplayStrategyId;
  label: string;
  status: "ready" | "unavailable";
  reason: "missing_history" | null;
  periodReturnPct: number | null;
  maxDrawdownPct: number | null;
  worstDayPct: number | null;
  path: readonly Readonly<{ date: string; normalizedValue: number }>[];
}>;

export type InvestmentLabStressReplayWindow = Readonly<{
  id: string;
  label: string;
  description: string;
  startDate: string;
  endDate: string;
  status: "ready" | "partial" | "unavailable";
  scopedCurrentValueKrw: number;
  eligibleCurrentValueKrw: number;
  currentValueCoveragePct: number;
  eligibleInstrumentCount: number;
  excludedHoldingCount: number;
  excludedHoldings: readonly Readonly<{
    name: string;
    ticker: string | null;
    account: string;
    reason:
      | "missing_ticker"
      | "unsupported_currency"
      | "non_positive_value"
      | "insufficient_price_history"
      | "insufficient_fx_history";
  }>[];
  priceBasis: Readonly<{
    adjustedInstrumentCount: number;
    privateRawInstrumentCount: number;
  }>;
  strategies: readonly InvestmentLabStressReplayStrategy[];
}>;

export type InvestmentLabStressReplay = Readonly<{
  policy: typeof INVESTMENT_LAB_STRESS_REPLAY_POLICY;
  account: string;
  windows: readonly InvestmentLabStressReplayWindow[];
}>;

type AggregatedHolding = {
  key: string;
  ticker: string;
  market: string;
  currency: "KRW" | "USD";
  currentValueKrw: number;
  sourceRows: InvestmentLabStressHoldingInput[];
};

type InstrumentPath = Readonly<{
  key: string;
  factors: readonly number[];
  priceBasis: "provider_adjusted_close" | "private_kis_raw_close";
}>;

const BENCHMARKS = Object.freeze({
  kodex200: Object.freeze({ key: "korea|KRW|069500", label: "전액 KODEX 200" }),
  voo: Object.freeze({ key: "us|USD|VOO", label: "전액 VOO" }),
});

export function buildInvestmentLabStressReplay({
  account,
  holdings,
  priceRows,
  fxRows,
  windows = INVESTMENT_LAB_STRESS_WINDOWS,
}: {
  account: string;
  holdings: readonly InvestmentLabStressHoldingInput[];
  priceRows: readonly InvestmentLabStressPriceInput[];
  fxRows: readonly InvestmentLabStressFxInput[];
  windows?: readonly InvestmentLabStressWindowDefinition[];
}): InvestmentLabStressReplay {
  const holdingUniverse = aggregateHoldings(holdings);
  const pricesByInstrument = groupPrices(priceRows);
  const normalizedFxRows = normalizeFxRows(fxRows);

  return Object.freeze({
    policy: INVESTMENT_LAB_STRESS_REPLAY_POLICY,
    account,
    windows: Object.freeze(
      windows.map((window) =>
        buildWindow({
          window,
          holdingUniverse,
          pricesByInstrument,
          fxRows: normalizedFxRows,
        }),
      ),
    ),
  });
}

function buildWindow({
  window,
  holdingUniverse,
  pricesByInstrument,
  fxRows,
}: {
  window: InvestmentLabStressWindowDefinition;
  holdingUniverse: ReturnType<typeof aggregateHoldings>;
  pricesByInstrument: ReadonlyMap<string, InvestmentLabStressPriceInput[]>;
  fxRows: readonly Readonly<{ rateDate: string; usdKrw: number }>[];
}): InvestmentLabStressReplayWindow {
  const axis = weekdayAxis(window.startDate, window.endDate);
  const instrumentPaths = new Map<string, InstrumentPath>();
  const excludedHoldings = [...holdingUniverse.exclusions];
  const eligibleHoldings: AggregatedHolding[] = [];

  for (const holding of holdingUniverse.instruments) {
    const result = buildInstrumentPath({
      axis,
      instrumentKey: holding.key,
      priceRows: pricesByInstrument.get(holding.key) ?? [],
      fxRows,
      currency: holding.currency,
    });
    if (result.status === "ready") {
      instrumentPaths.set(holding.key, result.path);
      eligibleHoldings.push(holding);
      continue;
    }
    for (const row of holding.sourceRows) {
      excludedHoldings.push({
        name: row.name,
        ticker: normalizeTicker(row.ticker),
        account: row.account,
        reason: result.reason,
      });
    }
  }

  for (const benchmark of Object.values(BENCHMARKS)) {
    if (instrumentPaths.has(benchmark.key)) continue;
    const currency = benchmark.key.split("|")[1];
    const result = buildInstrumentPath({
      axis,
      instrumentKey: benchmark.key,
      priceRows: pricesByInstrument.get(benchmark.key) ?? [],
      fxRows,
      currency: currency === "USD" ? "USD" : "KRW",
    });
    if (result.status === "ready") instrumentPaths.set(benchmark.key, result.path);
  }

  const eligibleCurrentValueKrw = sumBy(
    eligibleHoldings,
    (holding) => holding.currentValueKrw,
  );
  const coveragePct = percentage(
    eligibleCurrentValueKrw,
    holdingUniverse.scopedCurrentValueKrw,
  );
  const currentWeights = eligibleHoldings.map((holding) => ({
    key: holding.key,
    weight:
      eligibleCurrentValueKrw > 0
        ? holding.currentValueKrw / eligibleCurrentValueKrw
        : 0,
  }));
  const equalWeights = eligibleHoldings.map((holding) => ({
    key: holding.key,
    weight: eligibleHoldings.length > 0 ? 1 / eligibleHoldings.length : 0,
  }));
  const strategies = Object.freeze([
    weightedStrategy("current_composition", "현재 구성", currentWeights, instrumentPaths, axis),
    weightedStrategy("equal_weight", "동일 비중", equalWeights, instrumentPaths, axis),
    benchmarkStrategy("kodex200", BENCHMARKS.kodex200, instrumentPaths, axis),
    benchmarkStrategy("voo", BENCHMARKS.voo, instrumentPaths, axis),
    readyStrategy("cash", "현금", axis.map((date) => ({ date, normalizedValue: 1 }))),
  ]);
  const basisKeys = new Set(eligibleHoldings.map((holding) => holding.key));
  for (const benchmark of Object.values(BENCHMARKS)) basisKeys.add(benchmark.key);
  const selectedPaths = [...basisKeys]
    .map((key) => instrumentPaths.get(key))
    .filter((path): path is InstrumentPath => path !== undefined);

  return Object.freeze({
    id: window.id,
    label: window.label,
    description: window.description,
    startDate: window.startDate,
    endDate: window.endDate,
    status:
      eligibleHoldings.length === 0
        ? "unavailable"
        : coveragePct >= 99.999
          ? "ready"
          : "partial",
    scopedCurrentValueKrw: holdingUniverse.scopedCurrentValueKrw,
    eligibleCurrentValueKrw,
    currentValueCoveragePct: coveragePct,
    eligibleInstrumentCount: eligibleHoldings.length,
    excludedHoldingCount: excludedHoldings.length,
    excludedHoldings: Object.freeze(excludedHoldings),
    priceBasis: Object.freeze({
      adjustedInstrumentCount: selectedPaths.filter(
        (path) => path.priceBasis === "provider_adjusted_close",
      ).length,
      privateRawInstrumentCount: selectedPaths.filter(
        (path) => path.priceBasis === "private_kis_raw_close",
      ).length,
    }),
    strategies,
  });
}

function aggregateHoldings(holdings: readonly InvestmentLabStressHoldingInput[]) {
  const instruments = new Map<string, AggregatedHolding>();
  const exclusions: InvestmentLabStressReplayWindow["excludedHoldings"][number][] = [];
  let scopedCurrentValueKrw = 0;

  for (const row of holdings) {
    const currentValueKrw = positiveNumber(row.currentValueKrw);
    if (currentValueKrw !== null) scopedCurrentValueKrw += currentValueKrw;
    const ticker = normalizeTicker(row.ticker);
    const market = row.market.trim().toLowerCase();
    const currency = row.currency.trim().toUpperCase();
    const reason = !ticker
      ? "missing_ticker"
      : currency !== "KRW" && currency !== "USD"
        ? "unsupported_currency"
        : currentValueKrw === null
          ? "non_positive_value"
          : null;
    if (reason) {
      exclusions.push({
        name: row.name,
        ticker,
        account: row.account,
        reason,
      });
      continue;
    }
    if (!ticker || !currentValueKrw || (currency !== "KRW" && currency !== "USD")) {
      continue;
    }
    const key = instrumentKey(market, currency, ticker);
    const current = instruments.get(key) ?? {
      key,
      ticker,
      market,
      currency,
      currentValueKrw: 0,
      sourceRows: [],
    };
    current.currentValueKrw += currentValueKrw;
    current.sourceRows.push(row);
    instruments.set(key, current);
  }

  return {
    scopedCurrentValueKrw,
    instruments: [...instruments.values()].sort((left, right) =>
      left.key.localeCompare(right.key),
    ),
    exclusions,
  };
}

function buildInstrumentPath({
  axis,
  instrumentKey,
  priceRows,
  fxRows,
  currency,
}:
  {
    axis: readonly string[];
    instrumentKey: string;
    priceRows: readonly InvestmentLabStressPriceInput[];
    fxRows: readonly Readonly<{ rateDate: string; usdKrw: number }>[];
    currency: "KRW" | "USD";
  }):
  | Readonly<{ status: "ready"; path: InstrumentPath }>
  | Readonly<{
      status: "unavailable";
      reason: "insufficient_price_history" | "insufficient_fx_history";
    }> {
  if (axis.length < 2) {
    return Object.freeze({ status: "unavailable", reason: "insufficient_price_history" });
  }
  const relevantRows = priceRows
    .filter((row) => rowKey(row) === instrumentKey)
    .filter((row) => positiveNumber(row.closePrice) !== null)
    .sort((left, right) => left.priceDate.localeCompare(right.priceDate));
  if (hasDuplicateDates(relevantRows, (row) => row.priceDate)) {
    return Object.freeze({ status: "unavailable", reason: "insufficient_price_history" });
  }
  const priceBasis = relevantRows[0]?.priceBasis;
  if (
    !priceBasis ||
    relevantRows.some((row) => row.priceBasis !== priceBasis)
  ) {
    return Object.freeze({ status: "unavailable", reason: "insufficient_price_history" });
  }

  const values: number[] = [];
  for (const date of axis) {
    const price = latestOnOrBefore(relevantRows, date, (row) => row.priceDate);
    if (
      !price ||
      riskCalendarDayDistance(price.priceDate, date) >
        INVESTMENT_LAB_STRESS_REPLAY_POLICY.priceCarryCalendarDays
    ) {
      return Object.freeze({ status: "unavailable", reason: "insufficient_price_history" });
    }
    let fxRate = 1;
    if (currency === "USD") {
      const fx = latestOnOrBefore(fxRows, date, (row) => row.rateDate);
      if (
        !fx ||
        riskCalendarDayDistance(fx.rateDate, date) >
          INVESTMENT_LAB_STRESS_REPLAY_POLICY.fxCarryCalendarDays
      ) {
        return Object.freeze({ status: "unavailable", reason: "insufficient_fx_history" });
      }
      fxRate = fx.usdKrw;
    }
    values.push(positiveNumber(price.closePrice)! * fxRate);
  }
  const initial = values[0];
  if (!(initial > 0)) {
    return Object.freeze({ status: "unavailable", reason: "insufficient_price_history" });
  }

  return Object.freeze({
    status: "ready",
    path: Object.freeze({
      key: instrumentKey,
      factors: Object.freeze(values.map((value) => value / initial)),
      priceBasis,
    }),
  });
}

function weightedStrategy(
  id: "current_composition" | "equal_weight",
  label: string,
  weights: readonly Readonly<{ key: string; weight: number }>[],
  paths: ReadonlyMap<string, InstrumentPath>,
  axis: readonly string[],
) {
  if (
    weights.length === 0 ||
    weights.some((row) => !paths.has(row.key))
  ) {
    return unavailableStrategy(id, label);
  }
  const path = axis.map((date, index) => ({
    date,
    normalizedValue: weights.reduce(
      (total, row) => total + row.weight * paths.get(row.key)!.factors[index],
      0,
    ),
  }));
  return readyStrategy(id, label, path);
}

function benchmarkStrategy(
  id: "kodex200" | "voo",
  benchmark: Readonly<{ key: string; label: string }>,
  paths: ReadonlyMap<string, InstrumentPath>,
  axis: readonly string[],
) {
  const instrument = paths.get(benchmark.key);
  return instrument
    ? readyStrategy(
        id,
        benchmark.label,
        axis.map((date, index) => ({
          date,
          normalizedValue: instrument.factors[index],
        })),
      )
    : unavailableStrategy(id, benchmark.label);
}

function readyStrategy(
  id: InvestmentLabStressReplayStrategyId,
  label: string,
  path: readonly Readonly<{ date: string; normalizedValue: number }>[],
): InvestmentLabStressReplayStrategy {
  const values = path.map((row) => row.normalizedValue);
  return Object.freeze({
    id,
    label,
    status: "ready",
    reason: null,
    periodReturnPct: (values.at(-1)! / values[0] - 1) * 100,
    maxDrawdownPct: maxDrawdown(values) * 100,
    worstDayPct: worstDayReturn(values) * 100,
    path: Object.freeze([...path]),
  });
}

function unavailableStrategy(
  id: InvestmentLabStressReplayStrategyId,
  label: string,
): InvestmentLabStressReplayStrategy {
  return Object.freeze({
    id,
    label,
    status: "unavailable",
    reason: "missing_history",
    periodReturnPct: null,
    maxDrawdownPct: null,
    worstDayPct: null,
    path: Object.freeze([]),
  });
}

function maxDrawdown(values: readonly number[]) {
  let peak = values[0] ?? 1;
  let drawdown = 0;
  for (const value of values) {
    peak = Math.max(peak, value);
    drawdown = Math.max(drawdown, peak > 0 ? (peak - value) / peak : 0);
  }
  return drawdown;
}

function worstDayReturn(values: readonly number[]) {
  let worst = 0;
  for (let index = 1; index < values.length; index += 1) {
    worst = Math.min(worst, values[index] / values[index - 1] - 1);
  }
  return worst;
}

function groupPrices(rows: readonly InvestmentLabStressPriceInput[]) {
  const groups = new Map<string, InvestmentLabStressPriceInput[]>();
  for (const row of rows) {
    const key = rowKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function normalizeFxRows(rows: readonly InvestmentLabStressFxInput[]) {
  const valuesByDate = new Map<string, Set<number>>();
  for (const row of rows) {
    if (row.status && row.status.trim().toLowerCase() !== "ok") continue;
    const usdKrw = positiveNumber(row.usdKrw);
    if (usdKrw === null) continue;
    const values = valuesByDate.get(row.rateDate) ?? new Set<number>();
    values.add(usdKrw);
    valuesByDate.set(row.rateDate, values);
  }
  return [...valuesByDate.entries()]
    .filter(([, values]) => values.size === 1)
    .map(([rateDate, values]) => ({
      rateDate,
      usdKrw: values.values().next().value!,
    }))
    .sort((left, right) => left.rateDate.localeCompare(right.rateDate));
}

function weekdayAxis(startDate: string, endDate: string) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  if (start > end) throw new TypeError("Stress replay dates must be ordered");
  const dates: string[] = [];
  for (let date = start; date <= end; date = new Date(date.getTime() + 86_400_000)) {
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function latestOnOrBefore<T>(
  rows: readonly T[],
  date: string,
  selectDate: (row: T) => string,
) {
  let low = 0;
  let high = rows.length - 1;
  let selected: T | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const row = rows[middle];
    if (selectDate(row) <= date) {
      selected = row;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return selected;
}

function hasDuplicateDates<T>(rows: readonly T[], select: (row: T) => string) {
  return new Set(rows.map(select)).size !== rows.length;
}

function rowKey(row: { market: string; currency: string; ticker: string }) {
  return instrumentKey(
    row.market.trim().toLowerCase(),
    row.currency.trim().toUpperCase(),
    row.ticker.trim().toUpperCase(),
  );
}

function instrumentKey(market: string, currency: string, ticker: string) {
  return `${market}|${currency}|${ticker}`;
}

function normalizeTicker(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return normalized || null;
}

function positiveNumber(value: NumericInput) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function sumBy<T>(rows: readonly T[], select: (row: T) => number) {
  return rows.reduce((total, row) => total + select(row), 0);
}

function parseDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`Invalid stress replay date: ${value}`);
  }
  return parsed;
}
