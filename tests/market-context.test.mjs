import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  groupGlobalMarketFactorsByFamily,
  selectLatestBenchmarksByTicker,
  selectLatestGlobalMarketFactorsByKey,
  selectLatestMarketRegimesByAccount,
  summarizeMarketRegimeDuplicateGroups,
} from "../src/lib/market-context.ts";

function tieBreakFields(overrides = {}) {
  return {
    legacyBase44Id: "aaaaaaaaaaaaaaaaaaaaaaaa",
    base44UpdatedAt: null,
    updatedAt: "2026-07-05T00:00:00.000Z",
    createdAt: "2026-07-05T00:00:00.000Z",
    ...overrides,
  };
}

function regime(overrides) {
  return {
    regimeDate: "2026-07-05",
    account: "brokerage",
    ...tieBreakFields(),
    ...overrides,
  };
}

function factor(overrides) {
  return {
    factorDate: "2026-06-23",
    factorKey: "USD_KRW",
    factorFamily: "fx",
    ...tieBreakFields(),
    ...overrides,
  };
}

function benchmark(overrides) {
  return {
    benchmarkDate: "2026-06-23",
    benchmarkTicker: "VOO",
    ...tieBreakFields(),
    ...overrides,
  };
}

describe("market context selection helpers", () => {
  it("selects one market regime per account with deterministic tie-breaks", () => {
    const rows = [
      regime({
        legacyBase44Id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        base44UpdatedAt: "2026-07-05T08:00:00.000Z",
      }),
      regime({
        legacyBase44Id: "bbbbbbbbbbbbbbbbbbbbbbbb",
        base44UpdatedAt: "2026-07-05T09:00:00.000Z",
      }),
      regime({
        regimeDate: "2026-07-04",
        account: "isa",
        legacyBase44Id: "cccccccccccccccccccccccc",
        base44UpdatedAt: "2026-07-06T09:00:00.000Z",
      }),
      regime({
        regimeDate: "2026-07-05",
        account: "isa",
        legacyBase44Id: "dddddddddddddddddddddddd",
        base44UpdatedAt: null,
      }),
    ];

    const selected = selectLatestMarketRegimesByAccount(rows);

    assert.deepEqual(
      selected.map((row) => [row.account, row.legacyBase44Id]),
      [
        ["brokerage", "bbbbbbbbbbbbbbbbbbbbbbbb"],
        ["isa", "dddddddddddddddddddddddd"],
      ],
    );
  });

  it("summarizes duplicate market regime groups and selected legacy id", () => {
    const groups = summarizeMarketRegimeDuplicateGroups([
      regime({
        legacyBase44Id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        base44UpdatedAt: "2026-07-05T08:00:00.000Z",
      }),
      regime({
        legacyBase44Id: "bbbbbbbbbbbbbbbbbbbbbbbb",
        base44UpdatedAt: "2026-07-05T09:00:00.000Z",
      }),
      regime({
        regimeDate: "2026-07-04",
        legacyBase44Id: "cccccccccccccccccccccccc",
      }),
    ]);

    assert.equal(groups.length, 1);
    assert.equal(groups[0].date, "2026-07-05");
    assert.equal(groups[0].account, "brokerage");
    assert.equal(groups[0].rowCount, 2);
    assert.equal(groups[0].selectedLegacyBase44Id, "bbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("uses updated_at, created_at, then legacy id when base44 timestamp ties", () => {
    const rows = [
      regime({
        legacyBase44Id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        base44UpdatedAt: null,
        updatedAt: "2026-07-05T08:00:00.000Z",
        createdAt: "2026-07-05T08:00:00.000Z",
      }),
      regime({
        legacyBase44Id: "bbbbbbbbbbbbbbbbbbbbbbbb",
        base44UpdatedAt: null,
        updatedAt: "2026-07-05T08:00:00.000Z",
        createdAt: "2026-07-05T08:00:00.000Z",
      }),
    ];

    const [selected] = selectLatestMarketRegimesByAccount(rows);

    assert.equal(selected.legacyBase44Id, "bbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("selects latest benchmark rows in requested ticker order", () => {
    const selected = selectLatestBenchmarksByTicker(
      [
        benchmark({ benchmarkTicker: "VOO", benchmarkDate: "2026-06-22" }),
        benchmark({ benchmarkTicker: "VOO", benchmarkDate: "2026-06-24" }),
        benchmark({ benchmarkTicker: "069500", benchmarkDate: "2026-06-23" }),
      ],
      ["069500", "VOO"],
    );

    assert.deepEqual(
      selected.map((row) => [row.benchmarkTicker, row.benchmarkDate]),
      [
        ["069500", "2026-06-23"],
        ["VOO", "2026-06-24"],
      ],
    );
  });

  it("selects latest global factor per key before grouping by family", () => {
    const selected = selectLatestGlobalMarketFactorsByKey([
      factor({
        factorKey: "USD_KRW",
        factorFamily: "fx",
        factorDate: "2026-06-22",
      }),
      factor({
        factorKey: "USD_KRW",
        factorFamily: "fx",
        factorDate: "2026-06-23",
      }),
      factor({
        factorKey: "US10Y",
        factorFamily: "sovereign_yield",
        factorDate: "2026-06-20",
      }),
    ]);

    const families = groupGlobalMarketFactorsByFamily(selected);

    assert.deepEqual(
      families.map((family) => [
        family.family,
        family.factors.map((row) => `${row.factorKey}:${row.factorDate}`),
      ]),
      [
        ["fx", ["USD_KRW:2026-06-23"]],
        ["sovereign_yield", ["US10Y:2026-06-20"]],
      ],
    );
  });
});
