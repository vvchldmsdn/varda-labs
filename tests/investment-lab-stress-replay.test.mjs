import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildInvestmentLabStressReplay } from "../src/lib/investment-lab-stress-replay.ts";

const TEST_WINDOW = Object.freeze({
  id: "fixture",
  label: "Fixture",
  description: "Synthetic fixture",
  startDate: "2020-02-19",
  endDate: "2020-02-21",
});

describe("investment lab historical stress replay", () => {
  it("renormalizes the eligible current-value subset and includes USD/KRW movement", () => {
    const model = buildInvestmentLabStressReplay({
      account: "all",
      holdings: [
        holding("KODEX 200", "069500", "korea", "KRW", 60),
        holding("VOO", "VOO", "us", "USD", 40),
        holding("Listed later", "LATE", "korea", "KRW", 20),
      ],
      priceRows: [
        price("069500", "korea", "KRW", "2020-02-19", 100, "provider_adjusted_close"),
        price("069500", "korea", "KRW", "2020-02-20", 105, "provider_adjusted_close"),
        price("069500", "korea", "KRW", "2020-02-21", 110, "provider_adjusted_close"),
        price("VOO", "us", "USD", "2020-02-19", 10, "private_kis_raw_close"),
        price("VOO", "us", "USD", "2020-02-20", 9.5, "private_kis_raw_close"),
        price("VOO", "us", "USD", "2020-02-21", 9, "private_kis_raw_close"),
      ],
      fxRows: [
        fx("2020-02-19", 1_000),
        fx("2020-02-20", 1_050),
        fx("2020-02-21", 1_100),
      ],
      windows: [TEST_WINDOW],
    });

    const window = model.windows[0];
    assert.equal(window.status, "partial");
    assert.equal(window.eligibleInstrumentCount, 2);
    assert.ok(closeTo(window.currentValueCoveragePct, 100 / 120 * 100));
    assert.equal(window.excludedHoldings.length, 1);
    assert.equal(window.excludedHoldings[0].reason, "insufficient_price_history");
    assert.deepEqual(window.priceBasis, {
      adjustedInstrumentCount: 1,
      privateRawInstrumentCount: 1,
    });

    const current = strategy(window, "current_composition");
    const equal = strategy(window, "equal_weight");
    assert.equal(current.status, "ready");
    assert.ok(closeTo(current.periodReturnPct, 5.6));
    assert.ok(closeTo(equal.periodReturnPct, 4.5));
    assert.ok(closeTo(strategy(window, "kodex200").periodReturnPct, 10));
    assert.ok(closeTo(strategy(window, "voo").periodReturnPct, -1));
    assert.equal(strategy(window, "cash").periodReturnPct, 0);
  });

  it("excludes only the USD instrument when bounded FX evidence is absent", () => {
    const model = buildInvestmentLabStressReplay({
      account: "brokerage",
      holdings: [
        holding("KODEX 200", "069500", "korea", "KRW", 60),
        holding("VOO", "VOO", "us", "USD", 40),
      ],
      priceRows: [
        price("069500", "korea", "KRW", "2020-02-19", 100, "provider_adjusted_close"),
        price("069500", "korea", "KRW", "2020-02-21", 90, "provider_adjusted_close"),
        price("VOO", "us", "USD", "2020-02-19", 10, "private_kis_raw_close"),
        price("VOO", "us", "USD", "2020-02-21", 11, "private_kis_raw_close"),
      ],
      fxRows: [],
      windows: [TEST_WINDOW],
    });

    const window = model.windows[0];
    assert.equal(window.status, "partial");
    assert.equal(window.currentValueCoveragePct, 60);
    assert.equal(window.eligibleInstrumentCount, 1);
    assert.equal(window.excludedHoldings[0].reason, "insufficient_fx_history");
    assert.ok(closeTo(strategy(window, "current_composition").periodReturnPct, -10));
    assert.equal(strategy(window, "voo").status, "unavailable");
  });

  it("does not bridge a price gap beyond the explicit carry limit", () => {
    const model = buildInvestmentLabStressReplay({
      account: "isa",
      holdings: [holding("KODEX 200", "069500", "korea", "KRW", 100)],
      priceRows: [
        price("069500", "korea", "KRW", "2020-02-19", 100, "provider_adjusted_close"),
      ],
      fxRows: [],
      windows: [
        {
          ...TEST_WINDOW,
          endDate: "2020-03-02",
        },
      ],
    });

    const window = model.windows[0];
    assert.equal(window.status, "unavailable");
    assert.equal(window.currentValueCoveragePct, 0);
    assert.equal(window.excludedHoldings[0].reason, "insufficient_price_history");
    assert.equal(strategy(window, "current_composition").status, "unavailable");
    assert.equal(strategy(window, "cash").status, "ready");
  });

  it("deduplicates equivalent FX but rejects a conflicting start-date rate", () => {
    const input = {
      account: "brokerage",
      holdings: [holding("VOO", "VOO", "us", "USD", 100)],
      priceRows: [
        price("VOO", "us", "USD", "2020-02-19", 10, "private_kis_raw_close"),
        price("VOO", "us", "USD", "2020-02-21", 11, "private_kis_raw_close"),
      ],
      windows: [TEST_WINDOW],
    };
    const equivalent = buildInvestmentLabStressReplay({
      ...input,
      fxRows: [
        fx("2020-02-19", 1_000),
        fx("2020-02-19", 1_000),
        fx("2020-02-21", 1_000),
      ],
    });
    const conflicting = buildInvestmentLabStressReplay({
      ...input,
      fxRows: [
        fx("2020-02-19", 1_000),
        fx("2020-02-19", 1_001),
        fx("2020-02-21", 1_000),
      ],
    });

    assert.equal(equivalent.windows[0].status, "ready");
    assert.equal(conflicting.windows[0].status, "unavailable");
    assert.equal(
      conflicting.windows[0].excludedHoldings[0].reason,
      "insufficient_fx_history",
    );
  });

  it("keeps the route server-rendered and separate from provider calls", () => {
    const component = readFileSync(
      "src/components/investment-lab/investment-lab-stress-replay.tsx",
      "utf8",
    );
    const query = readFileSync(
      "src/db/queries/investment-lab-stress-replay.ts",
      "utf8",
    );
    const page = readFileSync("src/app/investment-lab/page.tsx", "utf8");
    const audit = readFileSync(
      "scripts/audit-investment-lab-stress-replay.ts",
      "utf8",
    );

    assert.match(page, /InvestmentLabStressReplayContent/);
    assert.match(page, /portfolioStructurePromise/);
    assert.match(component, /hasMarketEvidence/);
    assert.doesNotMatch(component, /["']use client["']|\bfetch\s*\(|\/api\//);
    assert.doesNotMatch(query, /\bfetch\s*\(|createKis|runKis|\/api\//);
    assert.match(audit, /databaseMode: "select_only"/);
    assert.doesNotMatch(audit, /\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\bfetch\s*\(/);
  });
});

function holding(name, ticker, market, currency, currentValueKrw) {
  return {
    name,
    ticker,
    account: "brokerage",
    market,
    currency,
    currentValueKrw,
  };
}

function price(ticker, market, currency, priceDate, closePrice, priceBasis) {
  return { ticker, market, currency, priceDate, closePrice, priceBasis };
}

function fx(rateDate, usdKrw) {
  return { rateDate, usdKrw, status: "ok" };
}

function strategy(window, id) {
  const result = window.strategies.find((row) => row.id === id);
  assert.ok(result, `missing strategy ${id}`);
  return result;
}

function closeTo(actual, expected, epsilon = 1e-10) {
  return Math.abs(actual - expected) <= epsilon;
}
