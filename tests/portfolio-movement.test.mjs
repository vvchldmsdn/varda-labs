import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCurrentHoldingMovement } from "../src/lib/current-holding-movement.ts";

import {
  buildDailyPositionMovement,
  buildPreviousCloseMovement,
  hasFreshMovementPrice,
  isPortfolioMovementEligibleHolding,
} from "../src/lib/portfolio-movement.ts";

const movementCycle = {
  snapshotDate: "2026-07-08",
  liveWindowStartAt: new Date("2026-07-07T22:00:00.000Z"),
  liveWindowEndAt: new Date("2026-07-08T22:00:00.000Z"),
};

function assertClose(actual, expected, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

function holding(overrides = {}) {
  return {
    id: "asset-kr",
    legacyBase44Id: "legacy-kr",
    name: "KODEX 200",
    ticker: "069500",
    assetType: "etf",
    account: "brokerage",
    market: "korea",
    currency: "KRW",
    quantity: 10,
    currentPrice: 95,
    valueKrw: 950,
    priceFetchedAt: "2026-07-08T01:00:00.000Z",
    priceAsOf: null,
    priceQuoteType: "live",
    priceStatus: "ok",
    ...overrides,
  };
}

function position(overrides = {}) {
  return {
    id: "snap-kr",
    account: "brokerage",
    assetId: "asset-kr",
    legacyAssetId: "legacy-kr",
    ticker: "069500",
    assetName: "KODEX 200",
    assetType: "etf",
    marketValueKrw: 1000,
    unitPrice: 100,
    closePrice: null,
    currentPrice: null,
    fxRate: null,
    previousFxRate: null,
    ...overrides,
  };
}

function tradeEvent(overrides = {}) {
  return {
    eventDate: "2026-07-08",
    eventType: "buy",
    account: "brokerage",
    assetId: "asset-kr",
    legacyAssetId: "legacy-kr",
    ticker: "069500",
    assetName: "KODEX 200",
    amountKrw: 200,
    beforeValue: {},
    afterValue: {},
    ...overrides,
  };
}

function buildDaily(overrides = {}) {
  return buildDailyPositionMovement({
    holdings: [holding()],
    positionRows: [position()],
    eventRows: [],
    selectedAccount: "brokerage",
    baselineDate: "2026-07-07",
    usdKrwRate: 1516.89994,
    movementCycle,
    ...overrides,
  });
}

describe("execution-adjusted movement of currently held positions", () => {
  const quote = "2026-07-08T01:00:00Z";
  const mark = (quantity, extra = {}) => holding({ quantity, currentPrice: 110, valueKrw: quantity * 110, priceAsOf: quote, ...extra });
  const fill = (side, quantity, price, extra = {}) => tradeEvent({
    eventType: side, quantityDelta: quantity, price, amountKrw: quantity * price,
    movementEffectiveAt: "2026-07-08T00:30:00Z", ...extra,
  });
  const run = (holdings, positionRows, eventRows, overrides = {}) => buildCurrentHoldingMovement({
    holdings, positionRows, eventRows, priceRows: [], baselineDate: "2026-07-07",
    usdKrwRate: 1300, movementCycle, ...overrides,
  });
  it("separates the opening holding and the actual buying price on a top-up", () => {
    const result = run([mark(20)], [position({ quantity: 10 })], [fill("buy", 10, 108)]);
    assert.equal(result.changeKrw, 120);
    assert.equal(result.previousValueKrw, 1000);
    assert.deepEqual([result.priceChangeKrw, result.fxChangeKrw, result.valuationChangeKrw, result.quantityChangeKrw], [120, 0, 1200, 1080]);
    assert.deepEqual(result.rows[0].execution, { openingQuantity: 10, boughtQuantity: 10, soldQuantity: 0,
      openingMarkChangeKrw: 100, buyMarkChangeKrw: 20, sellAdjustmentKrw: 0, buyAmountKrw: 1080, sellAmountKrw: 0,
      averageBuyPrice: 108, buyPriceChangeLocal: 20, buyPriceReturnPctLocal: 20 / 1080 * 100,
      openingPriceChangeLocal: 100, totalPriceChangeLocal: 120 });
  });
  it("starts a new purchase at execution, not at the previous close (even with a prior close on file)", () => {
    const close = { ticker: "069500", market: "korea", currency: "KRW", priceDate: "2026-07-07", closePrice: 80 };
    const result = run([mark(2)], [], [fill("buy", 2, 108, { beforeValue: { quantity: 0 } })], { priceRows: [close] });
    assert.deepEqual([result.changeKrw, result.returnPct, result.rows[0].source], [4, null, "trade_execution"]);
    const unmatched = run([mark(3)], [], [fill("buy", 2, 108)], { priceRows: [close] });
    assert.equal(unmatched.changeKrw, null);
    assert.equal(unmatched.exclusions[0].reason, "incomplete_trade_attribution");
  });
  it("counts partial-sale execution proceeds once and excludes fully exited positions from this view", () => {
    const result = run([mark(6)], [position({ quantity: 10 })], [fill("sell", 4, 108)]);
    assert.equal(result.changeKrw, 92);
    assert.equal(result.rows[0].execution.sellAdjustmentKrw, -8);
    assert.equal(result.rows[0].execution.buyPriceReturnPctLocal, null);
    assert.equal(result.rows[0].tradeFlowKrw, -432);
    assert.equal(run([], [position({ quantity: 10 })], [fill("sell", 10, 108)]).changeKrw, null);
    const exited = run([mark(0)], [position({ quantity: 10 })], [fill("sell", 10, 108)]);
    assert.deepEqual([exited.changeKrw, exited.includedCount, exited.excludedCount], [null, 0, 0]);
  });
  it("reconciles fractional buys and sales at their own execution FX without inferring realized lots", () => {
    const us = mark(2.25, { market: "us", currency: "USD", ticker: "VOO", valueKrw: 2.25 * 110 * 1300 });
    const previous = position({ ticker: "VOO", quantity: 2, currency: "USD", fxRate: 1200, marketValueKrw: 240000 });
    const buy = fill("buy", .5, 108, { fxRate: 1250, amountKrw: 67500 });
    const sell = fill("sell", .25, 105, { fxRate: 1270, amountKrw: 33337.5 });
    const result = run([us], [previous], [buy, sell]);
    const detail = result.rows[0].execution;
    assert.equal(result.changeKrw, us.valueKrw - 240000 - (67500 - 33337.5));
    assert.equal(result.changeKrw, result.priceChangeKrw + result.fxChangeKrw);
    assert.equal(result.changeKrw, detail.openingMarkChangeKrw + detail.buyMarkChangeKrw + detail.sellAdjustmentKrw);
    assert.equal(detail.buyPriceChangeLocal, 1);
    assert.equal(detail.averageBuyPrice, 108);
    assert.equal(run([us], [previous], [{ ...buy, fxRate: null }, sell]).changeKrw, null);
  });
  it("withholds unverified changes, splits, ambiguous corrections, stale quotes, and inconsistent gross", () => {
    const opening = [position({ quantity: 10 })];
    assert.equal(run([mark(12)], opening, []).changeKrw, null);
    for (const invalid of [fill("split", 2, 108), fill("buy", 2, 108, { movementEvidence: "unresolved" }),
      fill("buy", 2, 108, { amountKrw: 210 }), fill("buy", 2, 108, { movementEffectiveAt: "2026-07-08T01:01:00Z" })]) {
      assert.equal(run([mark(12)], opening, [invalid]).changeKrw, null);
    }
    assert.equal(run([mark(12, { priceAsOf: null })], opening, [fill("buy", 2, 108)]).changeKrw, null);
  });
  it("does not apply a similarly named asset's executions across accounts or an unidentified trade to both", () => {
    const h = mark(2);
    const other = mark(5, { account: "isa", id: "isa-1" });
    const prior = position({ account: "isa", assetId: "isa-1", quantity: 5, marketValueKrw: 500 });
    const scoped = run([h, other], [prior], [fill("buy", 2, 108, { beforeValue: { quantity: 0 } })]);
    assert.equal(scoped.changeKrw, 54);
    const ambiguous = run([h, other], [prior], [fill("buy", 2, 108, { account: null, assetId: null, legacyAssetId: null })]);
    assert.equal(ambiguous.changeKrw, null);
    assert.ok(ambiguous.exclusions.every(e => e.reason === "ambiguous_trade_identity"));
    const missingLedger = run([h, other], [prior], [fill("ledger_evidence_unavailable", 0, 0, {
      movementEvidence: "unresolved", movementWindowResolved: true, assetId: null, legacyAssetId: null, ticker: null, assetName: null,
    })]);
    assert.deepEqual([missingLedger.changeKrw, missingLedger.exclusions[0].holdingId, missingLedger.exclusions[0].reason],
      [50, h.id, "incomplete_trade_attribution"]);
  });
  it("publishes independent local-price evidence for old and new shares without inventing the fill FX", () => {
    const us = mark(2, { market: "us", currency: "USD", currentPrice: 137.4, valueKrw: 357240 });
    const opening = position({ quantity: 1, unitPrice: 118.71, marketValueKrw: 154323, fxRate: 1300, currency: "USD" });
    const trade = fill("buy", 1, 138.5, { amountKrw: null, fxRate: null, beforeValue: { quantity: 1 } });
    const result = run([us], [opening], [trade]);
    assert.deepEqual([result.includedCount, result.excludedCount, result.changeKrw, result.returnPct], [0, 1, null, null]);
    assert.equal(result.exclusions[0].reason, "missing_trade_fx");
    const local = result.exclusions[0].localPurchases;
    assert.deepEqual([local.currency, local.openingQuantity, local.boughtQuantity, local.averageBuyPrice], ["USD", 1, 1, 138.5]);
    assertClose(local.openingPriceChangeLocal, 18.69);
    assertClose(local.buyPriceChangeLocal, -1.10);
    assertClose(local.buyPriceReturnPctLocal, -1.10 / 138.5 * 100);
    assertClose(local.totalPriceChangeLocal, 17.59);
    assert.equal(run([us], [], [trade]).exclusions[0].localPurchases.openingPriceChangeLocal, null);
    assert.equal(run([us], [opening], [{...trade, movementEffectiveAt: undefined}]).exclusions[0].localPurchases, undefined);
    assert.equal(run([us], [opening], [{...trade, movementEffectiveAt: undefined, createdAt: "2026-07-08T01:01:00Z"}]).exclusions[0].localPurchases, undefined);
    assertClose(run([us], [opening], [{...trade, movementEffectiveAt: undefined, createdAt: "2026-07-08T00:55:00Z"}]).exclusions[0].localPurchases.totalPriceChangeLocal, 17.59);
  });
});

describe("portfolio movement builder", () => {
  it("does not deduct an execution-baseline trade that is already included in its quantities", () => {
    const result = buildDaily({
      holdings: [holding({ quantity: 12, currentPrice: 100, valueKrw: 1200 })],
      positionRows: [position({ quantity: 12, marketValueKrw: 1200, capturedAt: "2026-07-07T22:40:00Z", description: "valuation_policy=execution_collection_v1" })],
      eventRows: [tradeEvent({ quantityDelta: 2, price: 100, createdAt: "2026-07-07T22:20:00Z" })],
    });
    assert.equal(result.ready, true);
    assert.equal(result.changeKrw, 0);
    assert.equal(result.tradeFlowKrw, 0);
    assert.equal(result.priceChangeKrw, 0);
  });

  it("deducts a post-execution trade even when its entered transaction timestamp is earlier", () => {
    const result = buildDaily({
      holdings: [holding({ quantity: 14, currentPrice: 100, valueKrw: 1400 })],
      positionRows: [position({ quantity: 12, marketValueKrw: 1200, capturedAt: "2026-07-07T22:40:00Z", description: "valuation_policy=execution_collection_v1" })],
      eventRows: [tradeEvent({ quantityDelta: 2, price: 100, recordedAt: "2026-07-07T22:20:00Z", createdAt: "2026-07-07T22:50:00Z" })],
    });
    assert.equal(result.ready, true);
    assert.equal(result.changeKrw, 0);
    assert.equal(result.tradeFlowKrw, 200);
    assert.equal(result.priceChangeKrw, 0);
  });

  it("does not guess whether an undated trade was included in an execution baseline", () => {
    const result = buildDaily({
      holdings: [holding({ quantity: 12, currentPrice: 100, valueKrw: 1200 })],
      positionRows: [position({ quantity: 12, marketValueKrw: 1200, capturedAt: "2026-07-07T22:40:00Z", description: "valuation_policy=execution_collection_v1" })],
      eventRows: [tradeEvent({ quantityDelta: 2, price: 100 })],
    });
    assert.equal(result.ready, false);
    assert.equal(result.reason, "incomplete_trade_attribution");
    assert.equal(result.changeKrw, null);
  });

  it("computes KRW snapshot movement from fresh current prices", () => {
    const result = buildDaily();
    const contribution = result.contributions.get("asset-kr");

    assert.equal(result.ready, true);
    assert.equal(result.source, "daily_position_snapshot");
    assert.equal(result.previousTotalKrw, 1000);
    assert.equal(result.changeKrw, -50);
    assert.equal(result.priceChangeKrw, -50);
    assert.equal(result.fxChangeKrw, 0);
    assert.equal(result.coverage.currentCoveragePct, 100);
    assert.equal(result.coverage.snapshotCoveragePct, 100);
    assert.equal(contribution?.changeKrw, -50);
    assert.equal(contribution?.priceChangeKrw, -50);
    assert.equal(contribution?.fxChangeKrw, 0);
    assert.deepEqual(result.contributionRows, [contribution]);
    assert.equal("legacyBase44Id" in result.contributionRows[0], false);
    assert.deepEqual(result.exclusions, []);
  });

  it("separates USD FX-only movement from unchanged prices", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          currency: "USD",
          quantity: 10,
          currentPrice: 100,
          valueKrw: 1_516_899.94,
        }),
      ],
      positionRows: [
        position({
          id: "snap-us",
          assetId: "asset-us",
          legacyAssetId: "legacy-us",
          ticker: "VOO",
          assetName: "VOO",
          marketValueKrw: 1_531_722.979,
          unitPrice: 100,
          fxRate: 1531.722979,
        }),
      ],
    });
    const contribution = result.contributions.get("asset-us");

    assert.equal(result.ready, true);
    assertClose(result.changeKrw, -14_823.039);
    assertClose(result.priceChangeKrw, 0);
    assertClose(result.fxChangeKrw, -14_823.039);
    assertClose(contribution?.changeKrw, -14_823.039);
    assertClose(contribution?.priceChangeKrw, 0);
    assertClose(contribution?.fxChangeKrw, -14_823.039);
  });

  it("keeps USD price and FX movement in one aggregate path", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          currency: "USD",
          quantity: 10,
          currentPrice: 105,
          valueKrw: 1_592_744.937,
        }),
      ],
      positionRows: [
        position({
          id: "snap-us",
          assetId: "asset-us",
          legacyAssetId: "legacy-us",
          ticker: "VOO",
          assetName: "VOO",
          marketValueKrw: 1_531_722.979,
          unitPrice: 100,
          fxRate: 1531.722979,
        }),
      ],
    });
    const contribution = result.contributions.get("asset-us");

    assert.equal(result.ready, true);
    assertClose(result.changeKrw, 61_021.958);
    assertClose(result.priceChangeKrw, 76_586.14895);
    assertClose(result.fxChangeKrw, -15_564.19095);
    assertClose(contribution?.changeKrw, 61_021.958);
    assertClose(contribution?.priceChangeKrw, 76_586.14895);
    assertClose(contribution?.fxChangeKrw, -15_564.19095);
  });

  it("derives closed-market movement from current and baseline evidence without calendar overrides", () => {
    const usdKrwRate = 1385.741836;
    const usHoldings = [
      {
        id: "asset-qqq",
        ticker: "QQQ",
        name: "Invesco QQQ Trust",
        quantity: 2,
        currentPrice: 713.44,
        previousPrice: 713.71,
      },
      {
        id: "asset-schd",
        ticker: "SCHD",
        name: "Schwab US Dividend Equity ETF",
        quantity: 62,
        currentPrice: 35.11,
        previousPrice: 35.1485,
      },
      {
        id: "asset-voo",
        ticker: "VOO",
        name: "Vanguard S&P 500 ETF",
        quantity: 4,
        currentPrice: 703.71,
        previousPrice: 704.77,
      },
    ];
    const result = buildDaily({
      usdKrwRate,
      holdings: usHoldings.map((row) =>
        holding({
          id: row.id,
          legacyBase44Id: `legacy-${row.ticker.toLowerCase()}`,
          name: row.name,
          ticker: row.ticker,
          market: "us",
          currency: "USD",
          quantity: row.quantity,
          currentPrice: row.currentPrice,
          valueKrw: row.quantity * row.currentPrice * usdKrwRate,
        }),
      ),
      positionRows: usHoldings.map((row) =>
        position({
          id: `snapshot-${row.ticker.toLowerCase()}`,
          assetId: row.id,
          legacyAssetId: `legacy-${row.ticker.toLowerCase()}`,
          ticker: row.ticker,
          assetName: row.name,
          marketValueKrw: row.quantity * row.previousPrice * usdKrwRate,
          unitPrice: row.previousPrice,
          fxRate: usdKrwRate,
        }),
      ),
    });

    assert.equal(result.ready, true);
    assertClose(result.changeKrw, -9_931.611738611567, 0.001);
    assertClose(result.priceChangeKrw, -9_931.611738611567, 0.001);
    assertClose(result.fxChangeKrw, 0);
    assertClose(
      result.changeKrw - result.fxChangeKrw,
      -9_931.611738611567,
      0.001,
    );
    assertClose(
      result.contributions.get("asset-voo")?.changeKrw,
      -5_875.54538464,
      0.001,
    );
    assertClose(
      result.contributions.get("asset-voo")?.priceChangeKrw,
      -5_875.54538464,
      0.001,
    );
    assert.equal(
      result.contributions.get("asset-voo")?.previousPrice,
      704.77,
    );
    assert.equal(
      result.contributions.get("asset-voo")?.currentPrice,
      703.71,
    );
  });

  it("returns zero when the cutoff baseline and current evidence are unchanged", () => {
    const usdKrwRate = 1385.741836;
    const quantity = 4;
    const price = 703.71;
    const result = buildDaily({
      usdKrwRate,
      holdings: [
        holding({
          id: "asset-voo",
          legacyBase44Id: "legacy-voo",
          name: "Vanguard S&P 500 ETF",
          ticker: "VOO",
          market: "us",
          currency: "USD",
          quantity,
          currentPrice: price,
          valueKrw: quantity * price * usdKrwRate,
        }),
      ],
      positionRows: [
        position({
          id: "snapshot-voo",
          assetId: "asset-voo",
          legacyAssetId: "legacy-voo",
          ticker: "VOO",
          assetName: "Vanguard S&P 500 ETF",
          marketValueKrw: quantity * price * usdKrwRate,
          unitPrice: price,
          fxRate: usdKrwRate,
        }),
      ],
    });

    assert.equal(result.ready, true);
    assertClose(result.changeKrw, 0);
    assertClose(result.priceChangeKrw, 0);
    assertClose(result.fxChangeKrw, 0);
    assertClose(result.contributions.get("asset-voo")?.changeKrw, 0);
  });

  it("subtracts post-baseline trade flow from holding movement", () => {
    const result = buildDaily({
      holdings: [holding({ currentPrice: 120, valueKrw: 1200 })],
      eventRows: [tradeEvent({ amountKrw: 200 })],
    });
    const contribution = result.contributions.get("asset-kr");

    assert.equal(result.ready, true);
    assert.equal(result.tradeFlowKrw, 200);
    assert.equal(result.changeKrw, 0);
    assert.equal(contribution?.tradeFlowKrw, 200);
    assert.equal(contribution?.changeKrw, 0);
  });

  it("adds post-baseline sell trade flow back to holding movement", () => {
    const result = buildDaily({
      holdings: [holding({ currentPrice: 90, valueKrw: 900 })],
      eventRows: [
        tradeEvent({
          eventType: "sell",
          amountKrw: 50,
        }),
      ],
    });
    const contribution = result.contributions.get("asset-kr");

    assert.equal(result.ready, true);
    assert.equal(result.tradeFlowKrw, -50);
    assert.equal(result.changeKrw, -50);
    assert.equal(contribution?.tradeFlowKrw, -50);
    assert.equal(contribution?.changeKrw, -50);
  });

  it("uses event account metadata when event.account is empty", () => {
    const result = buildDaily({
      holdings: [
        holding({
          account: "isa",
          currentPrice: 120,
          valueKrw: 1200,
        }),
      ],
      positionRows: [
        position({
          account: "isa",
        }),
      ],
      eventRows: [
        tradeEvent({
          account: null,
          amountKrw: 200,
          afterValue: { account: "isa" },
        }),
      ],
      selectedAccount: "isa",
    });

    assert.equal(result.ready, true);
    assert.equal(result.tradeFlowKrw, 200);
    assert.equal(result.contributions.get("asset-kr")?.changeKrw, 0);
  });

  it("excludes stale current prices from snapshot movement coverage", () => {
    const result = buildDaily({
      holdings: [
        holding({
          priceFetchedAt: "2026-07-07T21:59:59.000Z",
        }),
      ],
    });

    assert.equal(hasFreshMovementPrice(holding(), movementCycle), true);
    assert.equal(
      hasFreshMovementPrice(
        holding({ priceFetchedAt: "2026-07-07T21:59:59.000Z" }),
        movementCycle,
      ),
      false,
    );
    assert.equal(result.ready, false);
    assert.equal(result.reason, "missing_fresh_live_prices");
    assert.equal(result.contributions.size, 0);
    assert.equal(result.contributionRows.length, 0);
    assert.deepEqual(
      result.exclusions.map((exclusion) => exclusion.reason),
      ["missing_fresh_live_prices", "coverage_below_threshold"],
    );
    assert.equal(result.coverage.currentCoveragePct, 0);
  });

  it("keeps complete FX evidence when stale prices block total movement", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          currency: "USD",
          quantity: 10,
          currentPrice: 100,
          valueKrw: 1_516_899.94,
          priceFetchedAt: "2026-07-07T21:59:59.000Z",
        }),
      ],
      positionRows: [
        position({
          id: "snap-us",
          assetId: "asset-us",
          legacyAssetId: "legacy-us",
          ticker: "VOO",
          assetName: "VOO",
          marketValueKrw: 1_531_722.979,
          unitPrice: 100,
          fxRate: 1531.722979,
        }),
      ],
    });

    assert.equal(result.ready, false);
    assert.equal(result.changeKrw, null);
    assert.equal(result.previousTotalKrw, 1_531_722.979);
    assertClose(result.fxChangeKrw, -14_823.039);
    assert.equal(result.contributions.size, 0);
  });

  it("keeps a stale manual valuation out of the current movement cycle", () => {
    const manualHolding = holding({
      priceFetchedAt: null,
      priceAsOf: "2026-06-01T03:00:00.000Z",
      priceQuoteType: "manual_valuation",
      priceStatus: "stored_manual",
    });
    const result = buildDaily({ holdings: [manualHolding] });

    assert.equal(hasFreshMovementPrice(manualHolding, movementCycle), false);
    assert.equal(result.ready, false);
    assert.equal(result.changeKrw, null);
    assert.equal(result.contributions.size, 0);
    assert.deepEqual(
      result.exclusions.map((exclusion) => exclusion.reason),
      ["manual_valuation_not_updated_in_cycle", "coverage_below_threshold"],
    );
  });

  it("keeps holdings without a quoted instrument out of movement coverage", () => {
    const gold = holding({
      id: "asset-gold",
      legacyBase44Id: "legacy-gold",
      name: "Gold bullion",
      ticker: null,
      assetType: "commodity",
      quantity: 8,
      currentPrice: 225_750,
      valueKrw: 1_806_000,
      priceFetchedAt: null,
      priceQuoteType: null,
      priceStatus: null,
    });
    const result = buildDaily({
      holdings: [holding(), gold],
      positionRows: [
        position(),
        position({
          id: "snap-gold",
          assetId: "asset-gold",
          legacyAssetId: "legacy-gold",
          ticker: null,
          assetName: "Gold bullion",
          assetType: "commodity",
          marketValueKrw: 1_806_000,
        }),
      ],
    });

    assert.equal(isPortfolioMovementEligibleHolding(gold), false);
    assert.equal(
      isPortfolioMovementEligibleHolding({ assetType: "commodity", ticker: "GLD" }),
      true,
    );
    assert.equal(
      isPortfolioMovementEligibleHolding({ assetType: "etf", ticker: "-" }),
      false,
    );
    assert.equal(
      isPortfolioMovementEligibleHolding({ assetType: "etf", ticker: null }),
      false,
    );
    assert.equal(
      isPortfolioMovementEligibleHolding({ assetType: "cash", ticker: "CASH" }),
      false,
    );
    assert.equal(result.ready, true);
    assert.equal(result.contributions.size, 1);
    assert.equal(result.contributions.has("asset-gold"), false);
    assert.equal(result.coverage.currentCoveragePct, 100);
    assert.equal(result.coverage.snapshotCoveragePct, 100);
    assert.equal(result.coverage.countCoveragePct, 100);
    assert.deepEqual(result.exclusions, []);
  });

  it("uses a manual valuation entered inside the current movement cycle", () => {
    const manualHolding = holding({
      priceFetchedAt: null,
      priceAsOf: "2026-07-08T01:00:00.000Z",
      priceQuoteType: "manual_valuation",
      priceStatus: "stored_manual",
    });
    const result = buildDaily({ holdings: [manualHolding] });

    assert.equal(hasFreshMovementPrice(manualHolding, movementCycle), true);
    assert.equal(result.ready, true);
    assert.equal(result.changeKrw, -50);
    assert.equal(result.contributions.get("asset-kr")?.changeKrw, -50);
  });

  it("excludes unsupported currency instead of treating it as KRW", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-jpy",
          legacyBase44Id: "legacy-jpy",
          name: "Japan ETF",
          ticker: "JPETF",
          currency: "JPY",
        }),
      ],
      positionRows: [
        position({
          id: "snap-jpy",
          assetId: "asset-jpy",
          legacyAssetId: "legacy-jpy",
          ticker: "JPETF",
          assetName: "Japan ETF",
        }),
      ],
    });

    assert.equal(result.ready, false);
    assert.equal(result.reason, "missing_fresh_live_prices");
    assert.equal(result.contributions.size, 0);
    assert.equal(result.exclusions[0]?.reason, "unsupported_currency");
    assert.equal(result.exclusions[0]?.ticker, "JPETF");
    assert.equal(result.exclusions[0]?.assetName, "Japan ETF");
    assert.equal("legacyBase44Id" in result.exclusions[0], false);
    assert.equal(result.changeKrw, null);
  });

  it("does not render missing baseline FX as a clean zero contribution", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          currency: "USD",
          quantity: 10,
          currentPrice: 100,
          valueKrw: 1_516_899.94,
        }),
      ],
      positionRows: [
        position({
          id: "snap-us",
          assetId: "asset-us",
          legacyAssetId: "legacy-us",
          ticker: "VOO",
          assetName: "VOO",
          marketValueKrw: 1_531_722.979,
          unitPrice: 100,
          fxRate: null,
          previousFxRate: null,
        }),
      ],
    });

    assert.equal(result.ready, false);
    assert.equal(result.reason, "missing_fresh_live_prices");
    assert.equal(result.fxChangeKrw, null);
    assert.equal(result.contributions.has("asset-us"), false);
    assert.equal(result.exclusions[0]?.reason, "missing_baseline_fx");
    assert.equal(result.exclusions[0]?.ticker, "VOO");
  });

  it("keeps partial serializable contributions when aggregate coverage is blocked", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-a",
          legacyBase44Id: "legacy-a",
          name: "Asset A",
          ticker: "A",
          currentPrice: 95,
          valueKrw: 950,
        }),
        holding({
          id: "asset-b",
          legacyBase44Id: "legacy-b",
          name: "Asset B",
          ticker: "B",
          currentPrice: 200,
          valueKrw: 2000,
        }),
      ],
      positionRows: [
        position({
          id: "snap-a",
          assetId: "asset-a",
          legacyAssetId: "legacy-a",
          ticker: "A",
          assetName: "Asset A",
          marketValueKrw: 1000,
          unitPrice: 100,
        }),
      ],
    });

    assert.equal(result.ready, false);
    assert.equal(result.reason, "missing_fresh_live_prices");
    assert.equal(result.contributions.size, 0);
    assert.equal(result.contributionRows.length, 1);
    assert.equal(result.contributionRows[0].holdingId, "asset-a");
    assert.deepEqual(
      result.exclusions.map((exclusion) => exclusion.reason),
      ["missing_baseline_snapshot", "coverage_below_threshold"],
    );
  });

  it("keeps an unexplained disappearance out of the comparable subtotal", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-a",
          legacyBase44Id: "legacy-a",
          name: "Asset A",
          ticker: "A",
          currentPrice: 95,
          valueKrw: 950,
        }),
        holding({
          id: "asset-b",
          legacyBase44Id: "legacy-b",
          name: "Asset B",
          ticker: "B",
          currentPrice: 195,
          valueKrw: 1950,
        }),
      ],
      positionRows: [
        position({
          id: "snap-a",
          assetId: "asset-a",
          legacyAssetId: "legacy-a",
          ticker: "A",
          assetName: "Asset A",
          marketValueKrw: 1000,
          unitPrice: 100,
        }),
        position({
          id: "snap-b",
          assetId: "asset-b",
          legacyAssetId: "legacy-b",
          ticker: "B",
          assetName: "Asset B",
          marketValueKrw: 2000,
          unitPrice: 200,
        }),
        position({
          id: "snap-removed",
          assetId: null,
          legacyAssetId: "legacy-removed",
          ticker: "OLD",
          assetName: "Removed ETF",
          marketValueKrw: 100,
          unitPrice: 100,
        }),
      ],
    });
    const contributionSum = [...result.contributions.values()].reduce(
      (sum, contribution) => sum + contribution.changeKrw,
      0,
    );

    assert.equal(result.ready, true);
    assert.equal(contributionSum, -100);
    assert.equal(result.previousTotalKrw, 3000);
    assert.equal(result.changeKrw, -100);
    assert.ok(result.exclusions.some(e => e.snapshotId === "snap-removed" && e.reason === "incomplete_trade_attribution"));
  });

  it("admits complete verified liquidation profits and losses when the account has no current positions", () => {
    const pos = position({ quantity: 10, currency: "KRW" });
    const sold = price => tradeEvent({ eventType: "sell", quantityDelta: -10, price, amountKrw: 10 * price });
    for (const price of [105, 98, 100]) {
      const result = buildDaily({ holdings: [], positionRows: [pos], eventRows: [sold(price)] });
      assert.equal(result.ready, true);
      assert.deepEqual([result.previousTotalKrw, result.changeKrw, result.tradeFlowKrw, result.priceChangeKrw, result.fxChangeKrw],
        [1000, 10 * (price - 100), -10 * price, 10 * (price - 100), 0]);
    }
    for (const event of [{ ...sold(105), quantityDelta: -9, amountKrw: 945 }, { ...sold(105), assetId: "wrong-id" },
      { ...sold(105), account: "isa" }, { ...sold(105), amountKrw: 1040 }]) {
      const result = buildDaily({ holdings: [], positionRows: [pos], eventRows: [event] });
      assert.equal(result.changeKrw, null);
      assert.ok(result.exclusions.some(e => e.snapshotId === pos.id));
    }
  });

  it("attributes closed foreign sale proceeds without needing a final quote or inventing an order between fills", () => {
    const pos = position({ quantity: 2, currency: "USD", fxRate: 1000, marketValueKrw: 200000 });
    const fills = [[95, 1050], [110, 1200]].map(([price, fxRate]) => tradeEvent({
      eventType: "sell", quantityDelta: -1, price, fxRate, amountKrw: price * fxRate,
    }));
    for (const eventRows of [fills, [...fills].reverse()]) {
      const result = buildDaily({ holdings: [], positionRows: [pos], eventRows });
      assert.deepEqual([result.changeKrw, result.priceChangeKrw, result.fxChangeKrw], [31750, 5000, 26750]);
    }
  });

  it("does not treat an excluded current holding as a removed baseline position", () => {
    const result = buildDaily({
      holdings: [
        holding({
          id: "asset-a",
          legacyBase44Id: "legacy-a",
          name: "Asset A",
          ticker: "A",
          currentPrice: 95,
          valueKrw: 950,
        }),
        holding({
          id: "asset-b",
          legacyBase44Id: "legacy-b",
          name: "Asset B",
          ticker: "B",
          currentPrice: 105,
          valueKrw: 1050,
        }),
        holding({
          id: "asset-stale",
          legacyBase44Id: "legacy-stale",
          name: "Stale Asset",
          ticker: "STALE",
          currentPrice: 100,
          valueKrw: 100,
          priceFetchedAt: "2026-07-07T21:59:59.000Z",
        }),
      ],
      positionRows: [
        position({
          id: "snap-a",
          assetId: "asset-a",
          legacyAssetId: "legacy-a",
          ticker: "A",
          assetName: "Asset A",
          marketValueKrw: 1000,
          unitPrice: 100,
        }),
        position({
          id: "snap-b",
          assetId: "asset-b",
          legacyAssetId: "legacy-b",
          ticker: "B",
          assetName: "Asset B",
          marketValueKrw: 1000,
          unitPrice: 100,
        }),
        position({
          id: "snap-stale",
          assetId: "asset-stale",
          legacyAssetId: "legacy-stale",
          ticker: "STALE",
          assetName: "Stale Asset",
          marketValueKrw: 100,
          unitPrice: 100,
        }),
      ],
    });

    assert.equal(result.ready, true);
    assert.equal(result.changeKrw, 0);
    assert.equal(result.contributionRows.length, 2);
    assert.equal(result.exclusions.length, 1);
    assert.equal(result.exclusions[0].reason, "missing_fresh_live_prices");
    assertClose(result.coverage.currentCoveragePct, 95.23809523809523);
    assertClose(result.coverage.snapshotCoveragePct, 95.23809523809523);
  });

  it("computes previous-close fallback movement without snapshot rows", () => {
    const result = buildPreviousCloseMovement({
      holdings: [holding()],
      priceRows: [
        {
          market: "korea",
          currency: "KRW",
          ticker: "069500",
          priceDate: "2026-07-07",
          adjustedClosePrice: 80,
          closePrice: 100,
          closePriceKrw: 100,
          fxRate: null,
        },
      ],
      referenceDate: "2026-07-08",
      usdKrwRate: 1516.89994,
      movementCycle,
    });
    const contribution = result.contributions.get("asset-kr");

    assert.equal(result.ready, true);
    assert.equal(result.source, "asset_price_snapshot");
    assert.equal(result.previousTotalKrw, 1000);
    assert.equal(result.changeKrw, -50);
    assert.equal(contribution?.source, "asset_price_snapshot");
  });

  it("computes previous-close fallback USD price and FX movement", () => {
    const result = buildPreviousCloseMovement({
      holdings: [
        holding({
          id: "asset-us",
          legacyBase44Id: "legacy-us",
          name: "VOO",
          ticker: "VOO",
          market: "us",
          currency: "USD",
          quantity: 10,
          currentPrice: 105,
          valueKrw: 1_592_744.937,
        }),
      ],
      priceRows: [
        {
          market: "us",
          currency: "USD",
          ticker: "VOO",
          priceDate: "2026-07-07",
          adjustedClosePrice: 100,
          closePrice: 100,
          closePriceKrw: 1_531_722.979,
          fxRate: 1531.722979,
        },
      ],
      referenceDate: "2026-07-08",
      usdKrwRate: 1516.89994,
      movementCycle,
    });
    const contribution = result.contributions.get("asset-us");

    assert.equal(result.ready, true);
    assert.equal(result.source, "asset_price_snapshot");
    assertClose(result.changeKrw, 61_021.958);
    assertClose(result.priceChangeKrw, 76_586.14895);
    assertClose(result.fxChangeKrw, -15_564.19095);
    assertClose(contribution?.changeKrw, 61_021.958);
    assertClose(contribution?.priceChangeKrw, 76_586.14895);
    assertClose(contribution?.fxChangeKrw, -15_564.19095);
    assert.deepEqual(result.contributionRows, [contribution]);
  });

  it("does not select a same-ticker close from another market or currency", () => {
    const result = buildPreviousCloseMovement({
      holdings: [holding()],
      priceRows: [
        {
          market: "us",
          currency: "USD",
          ticker: "069500",
          priceDate: "2026-07-07",
          adjustedClosePrice: 500,
          closePrice: 500,
          closePriceKrw: 750_000,
          fxRate: 1500,
        },
        {
          market: "korea",
          currency: "KRW",
          ticker: "069500",
          priceDate: "2026-07-07",
          adjustedClosePrice: 100,
          closePrice: 100,
          closePriceKrw: 100,
          fxRate: null,
        },
      ],
      referenceDate: "2026-07-08",
      usdKrwRate: 1516.89994,
      movementCycle,
    });

    assert.equal(result.ready, true);
    assert.equal(result.previousTotalKrw, 1000);
    assert.equal(result.changeKrw, -50);
  });
});

it("partial ready coverage excludes a stale baseline from the comparable denominator",()=>{
 const holdings=[holding({id:'a',legacyBase44Id:null,ticker:'A',valueKrw:950}),holding({id:'b',legacyBase44Id:null,ticker:'B',valueKrw:950}),holding({id:'c',legacyBase44Id:null,ticker:'C',quantity:1,valueKrw:100,currentPrice:100,priceFetchedAt:'2026-07-01T00:00:00Z'})];
 const rows=[position({id:'sa',assetId:'a',legacyAssetId:null,ticker:'A'}),position({id:'sb',assetId:'b',legacyAssetId:null,ticker:'B'}),position({id:'sc',assetId:'c',legacyAssetId:null,ticker:'C',marketValueKrw:100})];
 const r=buildDaily({holdings,positionRows:rows});assert.equal(r.ready,true);assert.equal(r.previousTotalKrw,2000);assert.equal(r.changeKrw,-100);assert.equal(r.returnPct,-5);assert.ok(r.coverage.snapshotCoveragePct<100);
});
