import assert from "node:assert/strict";

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import { loadPortfolioRiskReadModel } from "../src/lib/portfolio-risk-read-loader.ts";

config({ path: ".env.local", quiet: true });

const ACCOUNTS = ["brokerage", "isa", "irp", "all"];
const WINDOWS = [30, 90, 252];
const TRACKED_ACCOUNTS = ["brokerage", "isa", "irp"];
const LEAK_PATTERN =
  /legacyBase44Id|holdingId|api[_-]?key|authorization|password|secret|token|[0-9a-f]{8}-[0-9a-f-]{27}|\b[0-9a-f]{24}\b/i;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);
let selectCount = 0;

const repository = {
  async loadAssets(account) {
    const selectedAccounts =
      account === "all" ? TRACKED_ACCOUNTS : [account];
    selectCount += 1;
    const rows = await sql.query(
      `
        select
          lower(trim(account)) as account,
          upper(trim(ticker)) as ticker,
          name,
          lower(trim(market)) as market,
          upper(trim(currency)) as currency,
          quantity::text as quantity
        from assets
        where lower(trim(account)) = any($1::text[])
        order by account, ticker nulls last, name
      `,
      [selectedAccounts],
    );
    return rows.map((row) => ({
      account: row.account,
      ticker: row.ticker,
      name: row.name,
      market: row.market,
      currency: row.currency,
      quantity: row.quantity,
    }));
  },

  async loadPrices({ tickers, sourceDateFrom, sourceDateTo }) {
    selectCount += 1;
    const rows = await sql.query(
      `
        select
          upper(trim(ticker)) as ticker,
          lower(trim(market)) as market,
          upper(trim(currency)) as currency,
          date::text as price_date,
          close_price::text as close_price,
          adjusted_close_price::text as adjusted_close_price,
          source,
          is_sample
        from asset_price_snapshots
        where upper(trim(ticker)) = any($1::text[])
          and date between $2::date and $3::date
        order by date, ticker
      `,
      [tickers, sourceDateFrom, sourceDateTo],
    );
    return rows.map((row) => ({
      ticker: row.ticker,
      market: row.market,
      currency: row.currency,
      priceDate: row.price_date,
      closePrice: row.close_price,
      adjustedClosePrice: row.adjusted_close_price,
      source: row.source,
      isSample: row.is_sample,
    }));
  },

  async loadFxRates({ sourceDateFrom, sourceDateTo }) {
    selectCount += 1;
    const rows = await sql.query(
      `
        select
          date::text as rate_date,
          usdkrw::text as usdkrw,
          source,
          status,
          is_sample
        from fx_rates
        where date between $1::date and $2::date
        order by date
      `,
      [sourceDateFrom, sourceDateTo],
    );
    return rows.map((row) => ({
      rateDate: row.rate_date,
      usdKrw: row.usdkrw,
      source: row.source,
      status: row.status,
      isSample: row.is_sample,
    }));
  },
};

async function main() {
  const countsBefore = await readRelevantCounts();
  const models = [];

  for (const account of ACCOUNTS) {
    for (const window of WINDOWS) {
      models.push(
        await loadPortfolioRiskReadModel(repository, { account, window }),
      );
    }
  }

  const countsAfter = await readRelevantCounts();
  assert.deepEqual(countsAfter, countsBefore, "SELECT audit changed row counts");
  assertNoLeak(models);

  const result = {
    audit: "portfolio_risk_read_model",
    readOnly: true,
    providerCalls: false,
    databaseSideEffects: false,
    selectCount,
    counts: countsAfter,
    scopes: models.map(compactModel),
  };
  assertNoLeak(result);
  console.log(JSON.stringify(result, null, 2));
}

async function readRelevantCounts() {
  selectCount += 1;
  const [row] = await sql.query(`
    select
      (select count(*)::int from assets) as assets,
      (select count(*)::int from asset_price_snapshots) as price_snapshots,
      (select count(*)::int from fx_rates) as fx_rates
  `);
  return row;
}

function compactModel(model) {
  return {
    ...model.selection,
    inputStatus: model.inputHealth.status,
    calculationStatus: model.calculation.calculationStatus,
    calculationReason: model.calculation.reason,
    serviceCycleDate: model.provenance.serviceCycleDate,
    priceSourceDateFrom: model.provenance.priceSourceDateFrom,
    fxSourceDateFrom: model.provenance.fxSourceDateFrom,
    sourceDateTo: model.provenance.sourceDateTo,
    firstServiceDate: model.provenance.firstServiceDate,
    lastServiceDate: model.provenance.lastServiceDate,
    weightAsOfServiceDate: model.provenance.weightAsOfServiceDate,
    requestedObservations: model.provenance.requestedReturnObservations,
    usableObservations: model.provenance.usableReturnObservations,
    coveragePct: model.provenance.returnCoveragePct,
    includedInstruments: model.provenance.includedInstrumentCount,
    excludedHoldings: model.provenance.excludedHoldingCount,
    blockers: model.inputHealth.blockers.map((blocker) => blocker.reason),
    undefinedCorrelationPairs:
      model.inputHealth.undefinedCorrelationPairCount,
    zeroVarianceCount: model.inputHealth.zeroVarianceInstruments.length,
    downDayObservations: model.inputHealth.downDayObservations,
  };
}

function assertNoLeak(value) {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(serialized, LEAK_PATTERN, "unsafe field/value leaked");
}

await main();
