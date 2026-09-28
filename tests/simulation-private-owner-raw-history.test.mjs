import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { simulationExpectedCloseDate, simulationExpectedServiceDates } from "../src/lib/simulation-market-calendar.ts";
import { shiftRiskDate } from "../src/lib/portfolio-risk-calendar.ts";
import {
  PRIVATE_OWNER_RAW_HISTORY_POLICY,
  buildPrivateOwnerRawHistory,
  resolveLatestCommonPrivateOwnerRawServiceDate,
  resolvePrivateOwnerRawAvailableServiceDates,
} from "../src/lib/simulation-private-owner-raw-history.ts";

describe("private owner KIS raw history", () => {
  it("builds a complete 90-return owner matrix without claiming adjustments", () => {
    const fixture = readyFixture();
    const result = buildPrivateOwnerRawHistory(fixture);

    assert.equal(result.status, "ready");
    assert.equal(result.matrix.status, "ready");
    assert.equal(result.matrix.matrix.length, 90);
    assert.equal(result.matrix.policy.priceBasis, "raw_price_return");
    assert.equal(result.matrix.policy.corporateActionAdjustment, "not_claimed");
    assert.equal(result.matrix.policy.distributionAdjustment, "not_claimed");
    assert.equal(result.instruments[0].admissionStatus, "ready");
    assert.equal(result.instruments[0].provenance.adjustment, "not_claimed");
    assert.equal(PRIVATE_OWNER_RAW_HISTORY_POLICY.providerCalls, "forbidden");
    assert.equal(PRIVATE_OWNER_RAW_HISTORY_POLICY.persistence, "forbidden");
  });

  it("supports a pinned longer read window without changing the default policy", () => {
    const fixture = readyFixture(111);
    const result = buildPrivateOwnerRawHistory({
      ...fixture,
      returnStepCount: 111,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.requestedReturnStepCount, 111);
    assert.equal(result.matrix.matrix.length, 111);
    assert.equal(result.instruments[0].storedCoverage.requiredReturnCount, 111);
    assert.equal(PRIVATE_OWNER_RAW_HISTORY_POLICY.returnStepCount, 90);
  });

  it("uses shared KIS evidence after the caller scopes the instrument universe", () => {
    const result = buildPrivateOwnerRawHistory(readyFixture());

    assert.equal(result.status, "ready");
    assert.equal(
      result.policy.ownerBoundary,
      "user_owned_instrument_universe",
    );
    assert.equal(result.policy.marketDataBoundary, "shared_instrument_date_cache");
  });

  it("keeps partial diagnostics instead of filling missing raw history", () => {
    const fixture = readyFixture();
    const result = buildPrivateOwnerRawHistory({
      ...fixture,
      priceRows: fixture.priceRows.filter(
        (row) =>
          !(
            row.ticker === "069500" &&
            row.priceDate >= shiftRiskDate(fixture.requestedEndServiceDate, -10)
          ),
      ),
    });

    assert.equal(result.status, "incomplete");
    assert.notEqual(result.matrix.status, "ready");
    assert.equal(
      result.instruments.find((row) => row.ticker === "069500").status,
      "stored_coverage_incomplete",
    );
    assert.equal(
      result.instruments.find((row) => row.ticker === "QQQ").status,
      "provenance_ready_for_separate_review",
    );
    assert.equal(
      result.instruments.find((row) => row.ticker === "QQQ").admissionStatus,
      "ready",
    );
  });

  it("keeps manual gold and managed sleeves out of the stochastic matrix", () => {
    const fixture = readyFixture();
    const result = buildPrivateOwnerRawHistory({
      ...fixture,
      instruments: [
        ...fixture.instruments,
        instrument("krx_gold", "KRW", "KRX_GOLD_1G", 500, "physical_commodity_position"),
        instrument("managed_product", "KRW", "FOUNT", 500, "managed_sleeve"),
      ],
    });

    assert.equal(result.matrix.instruments.length, 2);
    assert.equal(
      result.instruments.find((row) => row.ticker === "KRX_GOLD_1G").status,
      "manual_history_required",
    );
    assert.equal(
      result.instruments.find((row) => row.ticker === "FOUNT").status,
      "excluded_by_policy",
    );
  });

  it("resolves the latest common date from admitted shared evidence", () => {
    const fixture = readyFixture();
    const latestSourceRows = fixture.instruments.map((row) => ({
      market: row.market,
      currency: row.currency,
      ticker: row.ticker,
      latestSourceDate: shiftRiskDate(
        fixture.requestedEndServiceDate,
        -1,
      ),
      providerBindingCount: 1,
    }));

    assert.equal(
      resolveLatestCommonPrivateOwnerRawServiceDate({
        instruments: fixture.instruments,
        latestSourceRows,
        latestFxSourceDate: shiftRiskDate(
          fixture.requestedEndServiceDate,
          -1,
        ),
      }),
      fixture.requestedEndServiceDate,
    );
  });

  it("keeps missing open sessions and ignores FX-only weekends", () => {
    const instruments = [instrument("korea","KRW","069500",5000),instrument("us","USD","QQQ",5000)];
    const input = {endServiceDate:"2026-09-29",sourceDateFrom:"2026-09-23",instruments,
      priceRows:[rawRow(instruments[0],"2026-09-23",100),rawRow(instruments[1],"2026-09-23",100)],
      fxRows:[{rateDate:"2026-09-27",usdKrw:1000,status:"ok"}],requiresFx:true};
    assert.deepEqual(resolvePrivateOwnerRawAvailableServiceDates(input),["2026-09-24","2026-09-25","2026-09-26","2026-09-29"]);
    assert.deepEqual(resolvePrivateOwnerRawAvailableServiceDates({...input,requiresFx:false,fxRows:[]}),["2026-09-24","2026-09-25","2026-09-26","2026-09-29"]);
  });
  it("does not infer sessions outside verified calendars", () => {
    assert.equal(simulationExpectedCloseDate("korea","2025-09-29"),null);
    assert.equal(simulationExpectedCloseDate("unknown","2026-09-29"),null);
    assert.deepEqual(simulationExpectedServiceDates(["korea"],"2025-01-01","2025-12-31"),[]);
    assert.deepEqual(simulationExpectedServiceDates(["korea"],"2025-05-09","2026-01-03"),["2026-01-03"]);
  });

});

function readyFixture(returnStepCount = 90) {
  const requestedEndServiceDate = "2026-09-23";
  const allDates = simulationExpectedServiceDates(["korea","us"],"2026-02-01",requestedEndServiceDate);
  const serviceDates = allDates.slice(-(returnStepCount+1));
  const sourceDateFrom = shiftRiskDate(serviceDates[0],-1);
  const instruments = [instrument("korea","KRW","069500",5000),instrument("us","USD","QQQ",5000)];
  const scan = Array.from({length:250},(_,index)=>shiftRiskDate("2026-02-01",index)).filter(date=>date<requestedEndServiceDate);
  return {
    requestedEndServiceDate, sourceDateFrom, instruments,
    priceRows: instruments.flatMap((row,instrumentIndex)=>scan.filter(date =>
      simulationExpectedCloseDate(row.market,shiftRiskDate(date,1))===date).map((date,index)=>rawRow(row,date,100+instrumentIndex*20+index))),
    fxRows: scan.map((rateDate,index)=>({rateDate,usdKrw:1300+index,status:"ok"})),
  };
}

function instrument(
  market,
  currency,
  ticker,
  weightBps,
  classification = "listed_instrument",
) {
  return {
    instrumentKey: `${market}|${currency}|${ticker}`,
    market,
    currency,
    ticker,
    classification,
    weightBps,
  };
}

function rawRow(instrumentRow, priceDate, closePrice) {
  return {
    market: instrumentRow.market,
    currency: instrumentRow.currency,
    ticker: instrumentRow.ticker,
    priceDate,
    closePrice,
    source: "kis_history",
    providerSymbol: instrumentRow.ticker,
    providerExchange: instrumentRow.market === "us" ? "NAS" : "KRX",
    fetchedAt: `${priceDate}T12:00:00.000Z`,
  };
}
