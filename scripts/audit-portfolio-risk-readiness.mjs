import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { closeCalendarReferenceDateForAsset } from "../src/lib/snapshots/market-calendar.ts";

config({ path: ".env.local", quiet: true });

const ACCOUNT_SCOPES = ["brokerage", "isa", "irp", "all"];
const WINDOW_SIZES = [30, 90, 252];
const CARRY_LIMIT_DAYS = [0, 3, 5, 7, 10];
const INCLUDE_DETAILS = process.argv.includes("--details");
const POLICY_CANDIDATE = {
  maxPriceCarryDays: 7,
  maxFxCarryDays: 3,
  minimumReturnCoveragePct: 80,
  minimumInstruments: 2,
  dropLowCoverageInstruments: false,
};
const SUPPORTED_CURRENCIES = new Set(["KRW", "USD"]);
const TRACKED_ACCOUNTS = new Set(["brokerage", "isa", "irp"]);

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const [assets, prices, fxRows, databaseChecks] = await Promise.all([
    getCurrentAssets(),
    getCurrentTickerPrices(),
    getFxRows(),
    getDatabaseChecks(),
  ]);

  const priceRowsByTicker = groupBy(prices, (row) => row.ticker);
  const fxAudit = buildFxAudit(fxRows);
  const scopeAudits = Object.fromEntries(
    ACCOUNT_SCOPES.map((scope) => [
      scope,
      auditScope({ scope, assets, priceRowsByTicker, fxAudit }),
    ]),
  );

  const result = {
    audit: "portfolio_risk_readiness",
    readOnly: true,
    providerCalls: false,
    generatedAt: new Date().toISOString(),
    policyAlreadyApproved: {
      returnCurrencyMode: "krw_investor",
      returnType: "simple",
      covariance: "sample",
      annualizationFactor: 252,
      riskFreeRateAnnualPct: 0,
      formulaVersionCandidate: "portfolio_risk_v1",
    },
    auditPolicy: {
      serviceDateMapping:
        "A close or FX row dated D is observable in the KST 07:00 service cycle dated D+1.",
      instrumentIdentity: "market|currency|ticker",
      allAccountRule:
        "Aggregate same-instrument holdings across accounts before risk math; preserve accounts only as drilldown evidence.",
      canonicalFxSource: "fx_rates only",
      candidateCarryLimitDays: CARRY_LIMIT_DAYS,
      requestedReturnWindows: WINDOW_SIZES,
      policyCandidate: POLICY_CANDIDATE,
    },
    databaseChecks,
    fx: fxAudit.summary,
    scopes: scopeAudits,
    blockers: buildBlockers(databaseChecks, fxAudit, scopeAudits),
  };

  console.log(JSON.stringify(INCLUDE_DETAILS ? result : compactResult(result), null, 2));
}

async function getCurrentAssets() {
  return sql.query(`
    select
      name,
      upper(trim(ticker)) as ticker,
      lower(trim(account)) as account,
      lower(trim(market)) as market,
      upper(trim(currency)) as currency,
      coalesce(asset_type, '') as asset_type,
      quantity::text as quantity,
      coalesce(fractional_krw_value, 0)::text as fractional_krw_value
    from assets
    order by account, market, ticker nulls last, name
  `);
}

async function getCurrentTickerPrices() {
  return sql.query(`
    select
      upper(trim(ticker)) as ticker,
      lower(trim(market)) as market,
      upper(trim(currency)) as currency,
      date::text as price_date,
      adjusted_close_price::text as adjusted_close_price,
      close_price::text as close_price,
      fx_rate::text as legacy_fx_rate,
      close_price_krw::text as legacy_close_price_krw,
      coalesce(source, '') as source
    from asset_price_snapshots
    where upper(trim(ticker)) in (
      select distinct upper(trim(ticker))
      from assets
      where ticker is not null and trim(ticker) <> ''
    )
    order by ticker, date
  `);
}

async function getFxRows() {
  return sql.query(`
    select
      date::text as rate_date,
      usdkrw::text as usdkrw,
      coalesce(source, '') as source,
      coalesce(status, '') as status
    from fx_rates
    order by date, updated_at, created_at
  `);
}

async function getDatabaseChecks() {
  const [priceSummary] = await sql.query(`
    select
      count(*)::int as total_rows,
      count(distinct upper(trim(ticker)))::int as tickers,
      count(distinct date)::int as price_dates,
      count(*) filter (where currency = 'USD' and fx_rate is not null)::int as usd_legacy_fx_rows,
      count(*) filter (where currency = 'USD' and close_price_krw is not null)::int as usd_legacy_krw_rows
    from asset_price_snapshots
    where upper(trim(ticker)) in (
      select distinct upper(trim(ticker))
      from assets
      where ticker is not null and trim(ticker) <> ''
    )
  `);

  const [indexSummary] = await sql.query(`
    select
      exists (
        select 1
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'asset_price_snapshots'
          and indexname = 'asset_price_snapshots_ticker_date_unique'
      ) as price_ticker_date_unique_index,
      exists (
        select 1
        from pg_indexes
        where schemaname = current_schema()
          and tablename = 'fx_rates'
          and indexdef ilike 'create unique index%(%date%)'
      ) as fx_date_unique_index
  `);

  const priceDuplicateGroups = await sql.query(`
    select upper(trim(ticker)) as ticker, date::text as price_date, count(*)::int as rows
    from asset_price_snapshots
    group by upper(trim(ticker)), date
    having count(*) > 1
    order by rows desc, price_date desc, ticker
  `);

  const fxDuplicateGroups = await sql.query(`
    select
      date::text as rate_date,
      count(*)::int as rows,
      count(distinct usdkrw)::int as distinct_values
    from fx_rates
    group by date
    having count(*) > 1
    order by rate_date desc
  `);

  const currentTickerIdentityConflicts = await sql.query(`
    select
      upper(trim(ticker)) as ticker,
      count(distinct lower(trim(market)) || '|' || upper(trim(currency)))::int as identities,
      array_agg(distinct lower(trim(market)) || '|' || upper(trim(currency)) order by lower(trim(market)) || '|' || upper(trim(currency))) as market_currency
    from assets
    where ticker is not null and trim(ticker) <> ''
    group by upper(trim(ticker))
    having count(distinct lower(trim(market)) || '|' || upper(trim(currency))) > 1
    order by ticker
  `);

  const priceTickerIdentityConflicts = await sql.query(`
    select
      upper(trim(p.ticker)) as ticker,
      count(distinct lower(trim(p.market)) || '|' || upper(trim(p.currency)))::int as identities,
      array_agg(distinct lower(trim(p.market)) || '|' || upper(trim(p.currency)) order by lower(trim(p.market)) || '|' || upper(trim(p.currency))) as market_currency
    from asset_price_snapshots p
    where upper(trim(p.ticker)) in (
      select distinct upper(trim(ticker))
      from assets
      where ticker is not null and trim(ticker) <> ''
    )
    group by upper(trim(p.ticker))
    having count(distinct lower(trim(p.market)) || '|' || upper(trim(p.currency))) > 1
    order by ticker
  `);

  return {
    priceSummary,
    indexes: indexSummary,
    priceDuplicateGroups,
    fxDuplicateGroups,
    currentTickerIdentityConflicts,
    priceTickerIdentityConflicts,
  };
}

function auditScope({ scope, assets, priceRowsByTicker, fxAudit }) {
  const universe = buildInstrumentUniverse(assets, scope);
  const instruments = universe.instruments.map((instrument) =>
    attachPriceSeries(instrument, priceRowsByTicker.get(instrument.ticker) ?? []),
  );
  const serviceDates = uniqueSorted(
    instruments.flatMap((instrument) => instrument.series.map((row) => row.serviceDate)),
  );
  const calendarFailureSamples = uniqueObjects(
    instruments.flatMap((instrument) => instrument.calendarFailureSamples),
    (row) => `${row.market}|${row.currency}|${row.ticker}|${row.priceDate}`,
  );

  return {
    selectedHoldingCount: universe.selectedHoldingCount,
    eligibleHoldingCount: universe.eligibleHoldingCount,
    instrumentCount: instruments.length,
    multivariateReady: instruments.length >= 2,
    exclusions: summarizeExclusions(universe.exclusions),
    aggregatedInstruments: instruments
      .filter((instrument) => instrument.holdingCount > 1)
      .map(instrumentIdentitySummary),
    missingPriceSeries: instruments
      .filter((instrument) => instrument.priceRowCount === 0)
      .map(instrumentIdentitySummary),
    serviceCalendar: {
      firstDate: serviceDates[0] ?? null,
      lastDate: serviceDates.at(-1) ?? null,
      dates: serviceDates.length,
      calendarVerificationFailures: calendarFailureSamples.length,
      calendarFailureSamples: calendarFailureSamples.slice(0, 20),
    },
    windows: WINDOW_SIZES.map((windowSize) =>
      auditWindow({
        windowSize,
        serviceDates,
        instruments,
        fxSeries: fxAudit.series,
      }),
    ),
  };
}

function buildInstrumentUniverse(assets, scope) {
  const selected = assets.filter((asset) =>
    scope === "all"
      ? TRACKED_ACCOUNTS.has(asset.account)
      : asset.account === scope,
  );
  const exclusions = [];
  const instrumentsByKey = new Map();

  for (const asset of selected) {
    const quantity = finiteNumber(asset.quantity);
    const fractionalKrwValue = finiteNumber(asset.fractional_krw_value);

    if (!(quantity > 0 || fractionalKrwValue > 0)) {
      exclusions.push({ reason: "non_positive_holding", asset });
      continue;
    }
    if (!asset.ticker) {
      exclusions.push({ reason: "missing_ticker", asset });
      continue;
    }
    if (!SUPPORTED_CURRENCIES.has(asset.currency)) {
      exclusions.push({ reason: "unsupported_currency", asset });
      continue;
    }

    const key = instrumentKey(asset);
    const existing = instrumentsByKey.get(key) ?? {
      key,
      ticker: asset.ticker,
      market: asset.market,
      currency: asset.currency,
      names: new Set(),
      accounts: new Set(),
      assetTypes: new Set(),
      holdingCount: 0,
      quantity: 0,
      fractionalKrwValue: 0,
    };
    existing.names.add(asset.name);
    existing.accounts.add(asset.account);
    existing.assetTypes.add(asset.asset_type || "(blank)");
    existing.holdingCount += 1;
    existing.quantity += quantity;
    existing.fractionalKrwValue += fractionalKrwValue;
    instrumentsByKey.set(key, existing);
  }

  return {
    selectedHoldingCount: selected.length,
    eligibleHoldingCount: [...instrumentsByKey.values()].reduce(
      (sum, instrument) => sum + instrument.holdingCount,
      0,
    ),
    instruments: [...instrumentsByKey.values()].sort(compareInstruments),
    exclusions,
  };
}

function attachPriceSeries(instrument, tickerRows) {
  const matchingRows = tickerRows.filter(
    (row) =>
      row.market === instrument.market && row.currency === instrument.currency,
  );
  const metadataMismatchRows = tickerRows.length - matchingRows.length;
  const series = matchingRows
    .map((row) => {
      const localClose =
        positiveNumber(row.adjusted_close_price) || positiveNumber(row.close_price);
      if (!(localClose > 0)) return null;
      const serviceDate = shiftDate(row.price_date, 1);
      const expectedReferenceDate = closeCalendarReferenceDateForAsset(
        { market: instrument.market, currency: instrument.currency },
        serviceDate,
      );
      return {
        priceDate: row.price_date,
        serviceDate,
        localClose,
        calendarVerified: expectedReferenceDate === row.price_date,
        expectedReferenceDate,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.serviceDate.localeCompare(right.serviceDate));

  return {
    ...instrument,
    series,
    priceRowCount: series.length,
    firstPriceDate: series[0]?.priceDate ?? null,
    lastPriceDate: series.at(-1)?.priceDate ?? null,
    metadataMismatchRows,
    calendarVerificationFailures: series.filter((row) => !row.calendarVerified)
      .length,
    calendarFailureSamples: series
      .filter((row) => !row.calendarVerified)
      .slice(0, 20)
      .map((row) => ({
        ticker: instrument.ticker,
        market: instrument.market,
        currency: instrument.currency,
        priceDate: row.priceDate,
        serviceDate: row.serviceDate,
        expectedReferenceDate: row.expectedReferenceDate,
      })),
  };
}

function buildFxAudit(rows) {
  const rowsByDate = groupBy(rows, (row) => row.rate_date);
  const duplicateGroups = [...rowsByDate.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([rateDate, group]) => ({
      rateDate,
      rows: group.length,
      distinctValues: new Set(group.map((row) => row.usdkrw)).size,
    }));
  const series = [...rowsByDate.entries()]
    .filter(([, group]) => group.length === 1)
    .map(([rateDate, [row]]) => ({
      rateDate,
      serviceDate: shiftDate(rateDate, 1),
      value: positiveNumber(row.usdkrw),
      source: row.source || "(blank)",
      status: row.status || "(blank)",
    }))
    .filter((row) => row.value > 0)
    .sort((left, right) => left.serviceDate.localeCompare(right.serviceDate));

  return {
    series,
    duplicateGroups,
    summary: {
      totalRows: rows.length,
      distinctDates: rowsByDate.size,
      firstDate: rows[0]?.rate_date ?? null,
      lastDate: rows.at(-1)?.rate_date ?? null,
      duplicateGroups,
      statusDistribution: countBy(rows, (row) => row.status || "(blank)"),
      sourceDistribution: countBy(rows, (row) => row.source || "(blank)"),
      canonicalSeriesRows: series.length,
    },
  };
}

function auditWindow({ windowSize, serviceDates, instruments, fxSeries }) {
  const dates = serviceDates.slice(-(windowSize + 1));
  const requiresFx = instruments.some((instrument) => instrument.currency === "USD");
  const instrumentCoverage = instruments.map((instrument) => ({
    ...instrumentIdentitySummary(instrument),
    priceRows: instrument.priceRowCount,
    firstPriceDate: instrument.firstPriceDate,
    lastPriceDate: instrument.lastPriceDate,
    metadataMismatchRows: instrument.metadataMismatchRows,
    ...summarizeObservations(instrument.series, dates),
  }));
  const fxCoverage = requiresFx
    ? summarizeObservations(fxSeries, dates)
    : null;
  const portfolioCoverageByCarryLimitDays = Object.fromEntries(
    CARRY_LIMIT_DAYS.map((limit) => [
      String(limit),
      summarizePortfolioCoverage({
        dates,
        instruments,
        fxSeries,
        requiresFx,
        priceCarryLimitDays: limit,
        fxCarryLimitDays: limit,
        requestedReturnObservations: windowSize,
      }),
    ]),
  );
  const policyCoverage = summarizePortfolioCoverage({
    dates,
    instruments,
    fxSeries,
    requiresFx,
    priceCarryLimitDays: POLICY_CANDIDATE.maxPriceCarryDays,
    fxCarryLimitDays: POLICY_CANDIDATE.maxFxCarryDays,
    requestedReturnObservations: windowSize,
  });

  const result = {
    requestedReturnObservations: windowSize,
    requiredValueDates: windowSize + 1,
    availableServiceDates: dates.length,
    firstServiceDate: dates[0] ?? null,
    lastServiceDate: dates.at(-1) ?? null,
    instrumentCoverageSummary: summarizeInstrumentCoverage(instrumentCoverage),
    fxCoverage,
    portfolioCoverageByCarryLimitDays,
    policyEvaluation: {
      status: policyStatus({
        instrumentCount: instruments.length,
        returnCoveragePct: policyCoverage.returnCoveragePct,
      }),
      ...policyCoverage,
    },
  };
  if (INCLUDE_DETAILS) result.instrumentCoverage = instrumentCoverage;
  return result;
}

function summarizeInstrumentCoverage(rows) {
  return {
    minimumCoveragePct: minOrNull(rows.map((row) => row.coveragePct)),
    maximumCarryDays: maxOrNull(
      rows.map((row) => row.maxCarryDays).filter((value) => value !== null),
    ),
    instrumentsWithMissingDates: rows
      .filter((row) => row.missingCount > 0)
      .map((row) => ({
        ticker: row.ticker,
        market: row.market,
        currency: row.currency,
        missingCount: row.missingCount,
        coveragePct: row.coveragePct,
        firstPriceDate: row.firstPriceDate,
      })),
    instrumentsBelowCoverage: Object.fromEntries(
      [80, 90, 95, 100].map((threshold) => [
        String(threshold),
        rows
          .filter((row) => row.coveragePct < threshold)
          .map((row) => ({ ticker: row.ticker, coveragePct: row.coveragePct })),
      ]),
    ),
  };
}

function summarizeObservations(series, dates) {
  const observations = dates.map((date) => observationAt(series, date));
  const exactCount = observations.filter((row) => row?.carryDays === 0).length;
  const carriedCount = observations.filter((row) => row?.carryDays > 0).length;
  const missingCount = observations.filter((row) => !row).length;

  return {
    exactCount,
    carriedCount,
    missingCount,
    coveragePct: percent(exactCount + carriedCount, dates.length),
    maxCarryDays: maxOrNull(
      observations.filter(Boolean).map((row) => row.carryDays),
    ),
    maxConsecutiveCarriedDates: maxConsecutive(observations, (row) => row?.carryDays > 0),
    coverageByCarryLimitDays: Object.fromEntries(
      CARRY_LIMIT_DAYS.map((limit) => [
        String(limit),
        percent(
          observations.filter((row) => row && row.carryDays <= limit).length,
          dates.length,
        ),
      ]),
    ),
  };
}

function summarizePortfolioCoverage({
  dates,
  instruments,
  fxSeries,
  requiresFx,
  priceCarryLimitDays,
  fxCarryLimitDays,
  requestedReturnObservations,
}) {
  const usableDates = dates.map((date) => {
    const pricesReady = instruments.every((instrument) => {
      const observation = observationAt(instrument.series, date);
      return observation && observation.carryDays <= priceCarryLimitDays;
    });
    const fxObservation = requiresFx ? observationAt(fxSeries, date) : null;
    const fxReady =
      !requiresFx ||
      (fxObservation && fxObservation.carryDays <= fxCarryLimitDays);
    return pricesReady && fxReady;
  });
  let usableReturns = 0;
  for (let index = 1; index < usableDates.length; index += 1) {
    if (usableDates[index - 1] && usableDates[index]) usableReturns += 1;
  }

  return {
    usableValueDates: usableDates.filter(Boolean).length,
    usableReturnObservations: usableReturns,
    returnCoveragePct: percent(usableReturns, requestedReturnObservations),
  };
}

function policyStatus({ instrumentCount, returnCoveragePct }) {
  if (instrumentCount < POLICY_CANDIDATE.minimumInstruments) {
    return "insufficient_instruments";
  }
  if (returnCoveragePct === 100) return "ready";
  if (returnCoveragePct >= POLICY_CANDIDATE.minimumReturnCoveragePct) {
    return "partial";
  }
  return "insufficient_coverage";
}

function observationAt(series, serviceDate) {
  let low = 0;
  let high = series.length - 1;
  let selected = null;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = series[middle];
    if (candidate.serviceDate <= serviceDate) {
      selected = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (!selected) return null;
  return {
    sourceServiceDate: selected.serviceDate,
    carryDays: dateDifferenceDays(selected.serviceDate, serviceDate),
  };
}

function buildBlockers(databaseChecks, fxAudit, scopeAudits) {
  const calendarVerificationFailures = uniqueObjects(
    Object.values(scopeAudits).flatMap(
      (scope) => scope.serviceCalendar.calendarFailureSamples,
    ),
    (row) => `${row.market}|${row.currency}|${row.ticker}|${row.priceDate}`,
  );
  return {
    priceTickerDateDuplicates: databaseChecks.priceDuplicateGroups.length,
    fxDuplicateDates: fxAudit.duplicateGroups.length,
    currentTickerIdentityConflicts:
      databaseChecks.currentTickerIdentityConflicts.length,
    priceTickerIdentityConflicts:
      databaseChecks.priceTickerIdentityConflicts.length,
    serviceCalendarVerificationFailures: calendarVerificationFailures.length,
    serviceCalendarVerificationFailureSamples:
      calendarVerificationFailures.slice(0, 20),
    missingPriceSeriesByScope: Object.fromEntries(
      Object.entries(scopeAudits).map(([scope, audit]) => [
        scope,
        audit.missingPriceSeries.length,
      ]),
    ),
  };
}

function compactResult(result) {
  return {
    audit: result.audit,
    readOnly: result.readOnly,
    providerCalls: result.providerCalls,
    generatedAt: result.generatedAt,
    policyAlreadyApproved: result.policyAlreadyApproved,
    auditPolicy: result.auditPolicy,
    databaseChecks: {
      priceSummary: result.databaseChecks.priceSummary,
      indexes: result.databaseChecks.indexes,
      priceDuplicateGroupCount:
        result.databaseChecks.priceDuplicateGroups.length,
      fxDuplicateGroups: result.databaseChecks.fxDuplicateGroups,
      currentTickerIdentityConflicts:
        result.databaseChecks.currentTickerIdentityConflicts,
      priceTickerIdentityConflicts:
        result.databaseChecks.priceTickerIdentityConflicts,
    },
    fx: {
      totalRows: result.fx.totalRows,
      distinctDates: result.fx.distinctDates,
      firstDate: result.fx.firstDate,
      lastDate: result.fx.lastDate,
      duplicateGroups: result.fx.duplicateGroups,
      statusDistribution: result.fx.statusDistribution,
      canonicalSeriesRows: result.fx.canonicalSeriesRows,
    },
    scopes: Object.fromEntries(
      Object.entries(result.scopes).map(([scope, audit]) => [
        scope,
        {
          selectedHoldingCount: audit.selectedHoldingCount,
          eligibleHoldingCount: audit.eligibleHoldingCount,
          instrumentCount: audit.instrumentCount,
          multivariateReady: audit.multivariateReady,
          exclusionCount: audit.exclusions.count,
          exclusionReasons: audit.exclusions.reasonDistribution,
          aggregatedInstruments: audit.aggregatedInstruments,
          missingPriceSeries: audit.missingPriceSeries,
          serviceCalendar: {
            firstDate: audit.serviceCalendar.firstDate,
            lastDate: audit.serviceCalendar.lastDate,
            dates: audit.serviceCalendar.dates,
            calendarVerificationFailures:
              audit.serviceCalendar.calendarVerificationFailures,
          },
          windows: audit.windows.map((window) => ({
            requestedReturnObservations:
              window.requestedReturnObservations,
            availableServiceDates: window.availableServiceDates,
            firstServiceDate: window.firstServiceDate,
            lastServiceDate: window.lastServiceDate,
            instrumentCoverageSummary: window.instrumentCoverageSummary,
            fxCoverage: window.fxCoverage,
            portfolioCoverageByCarryLimitDays:
              window.portfolioCoverageByCarryLimitDays,
            policyEvaluation: window.policyEvaluation,
          })),
        },
      ]),
    ),
    blockers: result.blockers,
    detailCommand:
      "node --no-warnings scripts/audit-portfolio-risk-readiness.mjs --details",
  };
}

function instrumentIdentitySummary(instrument) {
  return {
    ticker: instrument.ticker,
    market: instrument.market,
    currency: instrument.currency,
    names: [...instrument.names].sort(),
    accounts: [...instrument.accounts].sort(),
    assetTypes: [...instrument.assetTypes].sort(),
    holdingCount: instrument.holdingCount,
  };
}

function summarizeExclusions(exclusions) {
  return {
    count: exclusions.length,
    reasonDistribution: countBy(exclusions, (row) => row.reason),
    rows: exclusions.map(({ reason, asset }) => ({
      reason,
      name: asset.name,
      ticker: asset.ticker || null,
      account: asset.account,
      market: asset.market,
      currency: asset.currency,
      assetType: asset.asset_type || "(blank)",
    })),
  };
}

function instrumentKey(value) {
  return `${value.market}|${value.currency}|${value.ticker}`;
}

function compareInstruments(left, right) {
  return (
    left.market.localeCompare(right.market) ||
    left.currency.localeCompare(right.currency) ||
    left.ticker.localeCompare(right.ticker)
  );
}

function groupBy(rows, selector) {
  const groups = new Map();
  for (const row of rows) {
    const key = selector(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return groups;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function shiftDate(date, deltaDays) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + deltaDays);
  return value.toISOString().slice(0, 10);
}

function dateDifferenceDays(earlier, later) {
  return Math.round(
    (Date.parse(`${later}T00:00:00.000Z`) -
      Date.parse(`${earlier}T00:00:00.000Z`)) /
      (24 * 60 * 60 * 1000),
  );
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function percent(numerator, denominator) {
  if (!(denominator > 0)) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function maxOrNull(values) {
  return values.length > 0 ? Math.max(...values) : null;
}

function minOrNull(values) {
  return values.length > 0 ? Math.min(...values) : null;
}

function uniqueObjects(values, selector) {
  const seen = new Set();
  return values.filter((value) => {
    const key = selector(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function maxConsecutive(values, predicate) {
  let current = 0;
  let maximum = 0;
  for (const value of values) {
    if (predicate(value)) {
      current += 1;
      maximum = Math.max(maximum, current);
    } else {
      current = 0;
    }
  }
  return maximum;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
