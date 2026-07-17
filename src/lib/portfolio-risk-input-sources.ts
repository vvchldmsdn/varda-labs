import {
  isRiskDate,
  mapRiskEvidenceDateToServiceDate,
  shiftRiskDate,
} from "./portfolio-risk-calendar.ts";
import {
  normalizeCurrencyCode,
  normalizeTicker,
  toNumber,
} from "./portfolio-math.ts";
import type {
  AggregatedRiskInstrument,
  PortfolioRiskFxInput,
  PortfolioRiskHoldingInput,
  PortfolioRiskInputExclusion,
  PortfolioRiskPriceInput,
  RiskFxObservation,
  RiskPriceObservation,
} from "./portfolio-risk-input-types.ts";

export function aggregateRiskHoldings(
  holdings: readonly PortfolioRiskHoldingInput[],
) {
  const instruments = new Map<string, AggregatedRiskInstrument>();
  const exclusions: PortfolioRiskInputExclusion[] = [];
  let eligibleHoldingCount = 0;

  for (const holding of holdings) {
    const ticker = normalizeTicker(holding.ticker);
    const currency = normalizeCurrencyCode(holding.currency);
    const quantity = toNumber(holding.quantity) ?? 0;
    const exclusion = exclusionReason({ ticker, currency, quantity });

    if (exclusion) {
      exclusions.push({
        account: holding.account,
        ticker,
        name: holding.name,
        market: holding.market.trim().toLowerCase(),
        currency,
        assetType: holding.assetType?.trim().toLowerCase() || null,
        reason: exclusion,
      });
      continue;
    }
    if (!ticker || (currency !== "KRW" && currency !== "USD")) continue;

    const market = holding.market.trim().toLowerCase();
    const key = riskInstrumentKey(market, currency, ticker);
    const instrument = instruments.get(key) ?? {
      key,
      ticker,
      market,
      currency,
      names: new Set<string>(),
      accounts: new Set<string>(),
      quantity: 0,
    };
    instrument.names.add(holding.name.trim() || ticker);
    instrument.accounts.add(holding.account);
    instrument.quantity += quantity;
    instruments.set(key, instrument);
    eligibleHoldingCount += 1;
  }

  return {
    instruments: [...instruments.values()].sort((left, right) =>
      left.key.localeCompare(right.key),
    ),
    eligibleHoldingCount,
    exclusions,
  };
}

export function normalizeRiskPriceRows(
  rows: readonly PortfolioRiskPriceInput[],
  instrumentKeys: ReadonlySet<string>,
) {
  const rowsByInstrumentDate = new Map<string, PortfolioRiskPriceInput[]>();
  let invalidRowCount = 0;

  for (const row of rows) {
    const ticker = normalizeTicker(row.ticker);
    const currency = normalizeCurrencyCode(row.currency);
    const market = row.market.trim().toLowerCase();
    if (!ticker || !isRiskDate(row.priceDate)) {
      invalidRowCount += 1;
      continue;
    }
    const key = riskInstrumentKey(market, currency, ticker);
    if (!instrumentKeys.has(key)) continue;
    const groupKey = `${key}|${row.priceDate}`;
    const group = rowsByInstrumentDate.get(groupKey) ?? [];
    group.push(row);
    rowsByInstrumentDate.set(groupKey, group);
  }

  const seriesByInstrument = new Map<string, RiskPriceObservation[]>();
  const duplicateDatesByInstrument = new Map<string, string[]>();

  for (const group of rowsByInstrumentDate.values()) {
    const row = group[0];
    const ticker = normalizeTicker(row.ticker);
    if (!ticker) continue;
    const key = riskInstrumentKey(
      row.market.trim().toLowerCase(),
      normalizeCurrencyCode(row.currency),
      ticker,
    );
    if (group.length > 1) {
      const dates = duplicateDatesByInstrument.get(key) ?? [];
      dates.push(row.priceDate);
      duplicateDatesByInstrument.set(key, dates);
      continue;
    }

    const close = positiveNumber(row.adjustedClosePrice) ?? positiveNumber(row.closePrice);
    if (close === null) {
      invalidRowCount += 1;
      continue;
    }
    const series = seriesByInstrument.get(key) ?? [];
    series.push({
      sourceDate: row.priceDate,
      serviceDate: mapRiskEvidenceDateToServiceDate(row.priceDate),
      localClose: close,
    });
    seriesByInstrument.set(key, series);
  }

  for (const series of seriesByInstrument.values()) {
    series.sort((left, right) =>
      left.serviceDate.localeCompare(right.serviceDate),
    );
  }

  return {
    seriesByInstrument,
    duplicateGroups: [...duplicateDatesByInstrument.entries()].map(
      ([instrumentKey, dates]) => ({
        instrumentKey,
        dates: uniqueSortedRiskDates(dates),
      }),
    ),
    invalidRowCount,
  };
}

export function findRelevantDuplicateRiskFxDates(
  rows: readonly PortfolioRiskFxInput[],
  selectedServiceDates: readonly string[],
  maxFxCarryDays: number,
) {
  const firstServiceDate = selectedServiceDates[0];
  const lastServiceDate = selectedServiceDates.at(-1);
  if (!firstServiceDate || !lastServiceDate) return [];

  const scanStart = shiftRiskDate(firstServiceDate, -maxFxCarryDays);
  return [...groupValidFxDates(rows).entries()]
    .filter(([, group]) => group.length > 1)
    .filter(([rateDate]) => {
      const serviceDate = mapRiskEvidenceDateToServiceDate(rateDate);
      return serviceDate >= scanStart && serviceDate <= lastServiceDate;
    })
    .map(([rateDate]) => rateDate)
    .sort();
}

export function normalizeRiskFxRows(rows: readonly PortfolioRiskFxInput[]) {
  const series: RiskFxObservation[] = [];

  for (const [rateDate, group] of groupValidFxDates(rows)) {
    if (group.length !== 1) continue;
    const row = group[0];
    const rate = positiveNumber(row.usdKrw);
    const status = row.status?.trim().toLowerCase();
    if (rate === null || (status && status !== "ok")) continue;
    series.push({
      sourceDate: rateDate,
      serviceDate: mapRiskEvidenceDateToServiceDate(rateDate),
      rate,
    });
  }

  return series.sort((left, right) =>
    left.serviceDate.localeCompare(right.serviceDate),
  );
}

export function countInvalidRiskFxRows(rows: readonly PortfolioRiskFxInput[]) {
  return rows.filter((row) => {
    if (!isRiskDate(row.rateDate)) return true;
    const status = row.status?.trim().toLowerCase();
    return (
      positiveNumber(row.usdKrw) === null || Boolean(status && status !== "ok")
    );
  }).length;
}

export function uniqueSortedRiskDates(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function exclusionReason({
  ticker,
  currency,
  quantity,
}: {
  ticker: string | null;
  currency: string;
  quantity: number;
}) {
  if (!ticker) return "missing_ticker" as const;
  if (!(quantity > 0)) return "non_positive_holding" as const;
  if (currency !== "KRW" && currency !== "USD") {
    return "unsupported_currency" as const;
  }
  return null;
}

function groupValidFxDates(rows: readonly PortfolioRiskFxInput[]) {
  const rowsByDate = new Map<string, PortfolioRiskFxInput[]>();
  for (const row of rows) {
    if (!isRiskDate(row.rateDate)) continue;
    const group = rowsByDate.get(row.rateDate) ?? [];
    group.push(row);
    rowsByDate.set(row.rateDate, group);
  }
  return rowsByDate;
}

function riskInstrumentKey(market: string, currency: string, ticker: string) {
  return `${market}|${currency}|${ticker}`;
}

function positiveNumber(value: unknown) {
  const parsed = toNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}
