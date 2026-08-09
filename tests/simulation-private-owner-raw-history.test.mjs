import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shiftRiskDate } from "../src/lib/portfolio-risk-calendar.ts";
import {
  PRIVATE_OWNER_RAW_HISTORY_POLICY,
  buildPrivateOwnerRawHistory,
  resolveLatestCommonPrivateOwnerRawServiceDate,
} from "../src/lib/simulation-private-owner-raw-history.ts";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";

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

  it("fails closed as soon as a second active portfolio owner exists", () => {
    const result = buildPrivateOwnerRawHistory({
      ...readyFixture(),
      activeOwnerUserIds: [
        OWNER_ID,
        "22222222-2222-4222-8222-222222222222",
      ],
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.matrix, null);
    assert.deepEqual(result.scopeAdmission.issues, [
      "private_single_tenant_scope_not_established",
    ]);
    assert.equal(result.instruments[0].admissionStatus, "blocked_invalid_input");
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

  it("resolves the latest common date only inside the singleton boundary", () => {
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
        requestedOwnerUserId: OWNER_ID,
        activeOwnerUserIds: [OWNER_ID],
        instruments: fixture.instruments,
        latestSourceRows,
        latestFxSourceDate: shiftRiskDate(
          fixture.requestedEndServiceDate,
          -1,
        ),
      }),
      fixture.requestedEndServiceDate,
    );
    assert.equal(
      resolveLatestCommonPrivateOwnerRawServiceDate({
        requestedOwnerUserId: OWNER_ID,
        activeOwnerUserIds: [OWNER_ID, "another-owner"],
        instruments: fixture.instruments,
        latestSourceRows,
        latestFxSourceDate: shiftRiskDate(
          fixture.requestedEndServiceDate,
          -1,
        ),
      }),
      null,
    );
  });
});

function readyFixture() {
  const requestedEndServiceDate = "2026-04-01";
  const serviceDates = Array.from({ length: 91 }, (_, index) =>
    shiftRiskDate(requestedEndServiceDate, index - 90),
  );
  const instruments = [
    instrument("korea", "KRW", "069500", 5_000),
    instrument("us", "USD", "QQQ", 5_000),
  ];

  return {
    requestedOwnerUserId: OWNER_ID,
    activeOwnerUserIds: [OWNER_ID],
    requestedEndServiceDate,
    instruments,
    priceRows: instruments.flatMap((row, instrumentIndex) =>
      serviceDates.map((serviceDate, index) =>
        rawRow(
          row,
          shiftRiskDate(serviceDate, -1),
          100 + instrumentIndex * 20 + index,
        ),
      ),
    ),
    fxRows: serviceDates.map((serviceDate, index) => ({
      rateDate: shiftRiskDate(serviceDate, -1),
      usdKrw: 1_300 + index,
      status: "ok",
    })),
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
