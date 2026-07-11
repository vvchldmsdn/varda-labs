import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  canonicalizeSimulationReturnMatrixUniverse,
  composeSimulationReturnMatrixUniverseEvidence,
  hashSimulationReturnMatrixUniverse,
  planSimulationReturnMatrixUniverseRead,
} from "../src/lib/simulation-return-matrix-universe-evidence.ts";
import { loadSimulationReturnMatrixUniverseEvidence } from "../src/lib/simulation-return-matrix-read-loader.ts";
import { crossMarketSimulationFixture } from "./fixtures/simulation-return-matrix.mjs";

describe("Simulation return-matrix Universe Evidence Phase 0B", () => {
  it("loads the explicit cross-market window and emits reviewable coverage evidence", async () => {
    const fixture = crossMarketSimulationFixture();
    const calls = [];
    const result = await loadSimulationReturnMatrixUniverseEvidence(
      repository(fixture, calls),
      request(),
    );

    assert.deepEqual(calls, [
      {
        kind: "price",
        sourceDateFrom: "2026-06-26",
        sourceDateTo: "2026-07-07",
        instrumentKeys: ["korea|KRW|069500", "us|USD|VOO"],
      },
      {
        kind: "fx",
        sourceDateFrom: "2026-06-30",
        sourceDateTo: "2026-07-07",
      },
    ]);
    assert.equal(result.status, "ready");
    assert.equal(
      result.vectorReviewStatus,
      "eligible_for_scenario_vector_review",
    );
    assert.equal(
      result.matrixUniverseHash,
      "sha256:5358855d5efa82f3e71b47464e2888d03777b30958cf6260fe370c9aa86c8249",
    );
    assert.deepEqual(
      result.instruments.map((row) => [
        row.instrumentKey,
        row.displayName,
        row.priceCoverage.coveredServiceDateCount,
        row.fxCoverage.status === "required"
          ? row.fxCoverage.coveredServiceDateCount
          : null,
        row.returnCoverage.readyReturnCount,
      ]),
      [
        ["korea|KRW|069500", "KODEX 200", 3, null, 2],
        ["us|USD|VOO", "Vanguard S&P 500 ETF", 3, 3, 2],
      ],
    );
    assert.deepEqual(result.blockers, []);
    assert.deepEqual(result.exclusions, []);
  });

  it("computes FX coverage independently when a USD price history is missing", () => {
    const fixture = crossMarketSimulationFixture();
    const result = composeSimulationReturnMatrixUniverseEvidence({
      request: request(),
      queryRange: planSimulationReturnMatrixUniverseRead(request()).queryRange,
      priceRows: fixture.priceRows.filter((row) => row.ticker !== "VOO"),
      fxRows: fixture.fxRows,
    });
    const voo = result.instruments.find((row) => row.ticker === "VOO");

    assert.equal(result.status, "incomplete");
    assert.equal(result.matrixUniverseHash, null);
    assert.equal(result.vectorReviewStatus, "blocked_until_matrix_ready");
    assert.equal(voo?.priceCoverage.coveredServiceDateCount, 0);
    assert.deepEqual(voo?.priceCoverage.reasons, ["missing_price"]);
    assert.equal(voo?.fxCoverage.status, "required");
    assert.equal(voo?.fxCoverage.coveredServiceDateCount, 3);
    assert.deepEqual(voo?.fxCoverage.reasons, []);
    assert.equal(voo?.returnCoverage.readyReturnCount, 0);
  });

  it("blocks malformed requests before calling either repository method", async () => {
    let callCount = 0;
    const result = await loadSimulationReturnMatrixUniverseEvidence(
      {
        async loadPriceRows() {
          callCount += 1;
          return [];
        },
        async loadFxRows() {
          callCount += 1;
          return [];
        },
      },
      { ...request(), requestedServiceDates: ["2026-07-08", "2026-07-04"] },
    );

    assert.equal(callCount, 0);
    assert.equal(result.status, "blocked");
    assert.equal(result.queryRange, null);
    assert.equal(result.matrixUniverseHash, null);
    assert.ok(
      result.blockers.some(
        (blocker) => blocker.reason === "unsorted_service_dates",
      ),
    );
  });

  it("does not query FX for a KRW-only candidate set", async () => {
    const fixture = crossMarketSimulationFixture();
    let fxCalls = 0;
    const result = await loadSimulationReturnMatrixUniverseEvidence(
      {
        async loadPriceRows() {
          return fixture.priceRows.filter((row) => row.ticker === "069500");
        },
        async loadFxRows() {
          fxCalls += 1;
          return fixture.fxRows;
        },
      },
      {
        requestedServiceDates: fixture.requestedServiceDates,
        instruments: [request().instruments[0]],
      },
    );

    assert.equal(fxCalls, 0);
    assert.equal(result.status, "ready");
    assert.equal(result.instruments[0].fxCoverage.status, "not_required");
  });

  it("keeps the universe hash independent of labels and candidate input order", () => {
    const fixture = crossMarketSimulationFixture();
    const first = composeSimulationReturnMatrixUniverseEvidence({
      request: request(),
      queryRange: planSimulationReturnMatrixUniverseRead(request()).queryRange,
      priceRows: fixture.priceRows,
      fxRows: fixture.fxRows,
    });
    const reorderedRequest = {
      ...request(),
      instruments: [...request().instruments]
        .reverse()
        .map((row) => ({ ...row, displayName: `Renamed ${row.ticker}` })),
    };
    const second = composeSimulationReturnMatrixUniverseEvidence({
      request: reorderedRequest,
      queryRange:
        planSimulationReturnMatrixUniverseRead(reorderedRequest).queryRange,
      priceRows: [...fixture.priceRows].reverse(),
      fxRows: [...fixture.fxRows].reverse(),
    });

    assert.equal(first.status, "ready");
    assert.equal(second.status, "ready");
    assert.equal(second.matrixUniverseHash, first.matrixUniverseHash);
  });

  it("binds the hash to exact service dates and canonical identities, not matrix values", () => {
    const instruments = [
      {
        instrumentKey: "korea|KRW|069500",
        market: "korea",
        currency: "KRW",
        ticker: "069500",
      },
    ];
    const first = hashSimulationReturnMatrixUniverse(
      canonicalizeSimulationReturnMatrixUniverse({
        requestedServiceDates: ["2026-07-04", "2026-07-07"],
        instruments,
      }),
    );
    const second = hashSimulationReturnMatrixUniverse(
      canonicalizeSimulationReturnMatrixUniverse({
        requestedServiceDates: ["2026-07-04", "2026-07-08"],
        instruments,
      }),
    );

    assert.notEqual(first, second);
  });

  it("returns a minimized DTO without weights, values, ids, or source row metadata", () => {
    const fixture = crossMarketSimulationFixture();
    const result = composeSimulationReturnMatrixUniverseEvidence({
      request: request(),
      queryRange: planSimulationReturnMatrixUniverseRead(request()).queryRange,
      priceRows: fixture.priceRows.map((row) => ({
        ...row,
        id: "private-price-id",
        legacyBase44Id: "legacy-price-id",
        source: "provider-private-metadata",
      })),
      fxRows: fixture.fxRows.map((row) => ({
        ...row,
        id: "private-fx-id",
        legacyBase44Id: "legacy-fx-id",
        source: "provider-private-metadata",
      })),
    });
    const serialized = JSON.stringify(result);

    assert.doesNotMatch(
      serialized,
      /private-price|private-fx|legacyBase44|weightBps|quantity|currentValue|inputMatrixHash|drawPlanHash/i,
    );
    assert.doesNotMatch(serialized, /"matrix"|"value"|adjustedClosePrice/i);
  });

  it("keeps the production adapter server-only, read-only, and projection-minimized", () => {
    const source = readFileSync(
      "src/db/queries/simulation-return-matrix.ts",
      "utf8",
    );

    assert.match(source, /^import "server-only";/);
    assert.match(source, /\.select\(\{/);
    assert.doesNotMatch(source, /\.select\(\s*\)/);
    assert.match(source, /eq\(assetPriceSnapshots\.isSample, false\)/);
    assert.match(source, /eq\(fxRates\.isSample, false\)/);
    assert.match(source, /lower\(trim\(\$\{fxRates\.status\}\)\)/);
    assert.doesNotMatch(
      source,
      /\.insert\(|\.update\(|\.delete\(|\.returning\(|fetch\s*\(|livePriceQuotes|assets\b|weights|target/i,
    );
  });
});

function request() {
  const fixture = crossMarketSimulationFixture();
  return {
    requestedServiceDates: fixture.requestedServiceDates,
    instruments: [
      {
        displayName: "KODEX 200",
        market: "korea",
        currency: "KRW",
        ticker: "069500",
      },
      {
        displayName: "Vanguard S&P 500 ETF",
        market: "us",
        currency: "USD",
        ticker: "VOO",
      },
    ],
  };
}

function repository(fixture, calls) {
  return {
    async loadPriceRows(input) {
      calls.push({
        kind: "price",
        sourceDateFrom: input.sourceDateFrom,
        sourceDateTo: input.sourceDateTo,
        instrumentKeys: input.instruments.map(
          (row) => `${row.market}|${row.currency}|${row.ticker}`,
        ),
      });
      return fixture.priceRows;
    },
    async loadFxRows(input) {
      calls.push({ kind: "fx", ...input });
      return fixture.fxRows;
    },
  };
}
