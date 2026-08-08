import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planSimulationHistoryCompletion,
  SimulationHistoryCompletionInputError,
} from "../src/lib/market-data/simulation-history-completion.ts";

describe("simulation history completion planner", () => {
  it("deduplicates shared listed instruments and excludes holdings without provider identity", () => {
    const holdings = [
      holding({ accountCode: "brokerage", ticker: "069500" }),
      holding({ accountCode: "isa", ticker: "069500" }),
      holding({ accountCode: "irp", ticker: null }),
      holding({ accountCode: "brokerage", ticker: null }),
      holding({
        accountCode: "brokerage",
        market: "us",
        currency: "usd",
        ticker: "qqq",
      }),
    ];

    const plan = planSimulationHistoryCompletion({
      startDate: "2026-02-05",
      endDate: "2026-08-03",
      holdings,
    });

    assert.equal(plan.targets.length, 2);
    assert.equal(plan.selectedHoldingCount, 3);
    assert.equal(plan.excludedHoldingCount, 2);
    assert.deepEqual(plan.excludedByReason, { ticker_missing: 2 });
    assert.deepEqual(plan.targets.map((target) => target.key), [
      "korea|KRW|069500",
      "us|USD|QQQ",
    ]);
    assert.deepEqual(plan.targets[0].accounts, []);
    assert.deepEqual(plan.targets[0].assetIds, []);
    assert.deepEqual(plan.targets[0].assetNames, []);
  });

  it("uses the KIS five-instrument batch boundary", () => {
    const holdings = Array.from({ length: 12 }, (_, index) =>
      holding({ ticker: String(index).padStart(6, "0") }),
    );
    const plan = planSimulationHistoryCompletion({
      startDate: "2026-04-01",
      endDate: "2026-07-01",
      holdings,
    });

    assert.deepEqual(plan.batches.map((batch) => batch.length), [5, 5, 2]);
  });

  it("rejects ranges beyond the bounded operator window", () => {
    assert.throws(
      () =>
        planSimulationHistoryCompletion({
          startDate: "2026-01-01",
          endDate: "2026-08-01",
          holdings: [holding({})],
        }),
      SimulationHistoryCompletionInputError,
    );
  });
});

function holding(overrides) {
  return {
    accountCode: "brokerage",
    market: "korea",
    currency: "KRW",
    ticker: "069500",
    quantity: "1",
    ...overrides,
  };
}
