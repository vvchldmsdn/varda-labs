import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  canonicalizeSimulationReturnMatrixRequest,
  canonicalizeSimulationScenarioUniverse,
  composeSimulationReturnMatrixUniverseEvidence,
  hashSimulationReturnMatrixRequest,
  hashSimulationScenarioUniverse,
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
      result.scenarioUniverseHash,
      "sha256:1293274db83ef61de03f397dbbbc7eb3639dab4b372ce7b15c7120ed7c0618a6",
    );
    assert.equal(
      result.matrixRequestHash,
      "sha256:88553aad4265e2eb6a107930cadb02aea948fb7e5a2cc4130ea51d3dfede40d3",
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
    assert.match(result.scenarioUniverseHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.matrixRequestHash, /^sha256:[0-9a-f]{64}$/);
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
    assert.match(result.scenarioUniverseHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(result.matrixRequestHash, null);
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

  it("does not hash a partial or duplicate candidate universe", () => {
    const fixture = crossMarketSimulationFixture();
    const partial = composeSimulationReturnMatrixUniverseEvidence({
      request: {
        ...request(),
        instruments: [
          ...request().instruments,
          { displayName: "Invalid", market: null, currency: "KRW", ticker: "X" },
        ],
      },
      queryRange: null,
      priceRows: fixture.priceRows,
      fxRows: fixture.fxRows,
    });
    const duplicateRequest = {
      ...request(),
      instruments: [request().instruments[0], request().instruments[0]],
    };
    const duplicate = composeSimulationReturnMatrixUniverseEvidence({
      request: duplicateRequest,
      queryRange: null,
      priceRows: fixture.priceRows,
      fxRows: fixture.fxRows,
    });

    assert.equal(partial.status, "incomplete");
    assert.equal(partial.scenarioUniverseHash, null);
    assert.equal(partial.matrixRequestHash, null);
    assert.equal(duplicate.status, "blocked");
    assert.equal(duplicate.scenarioUniverseHash, null);
    assert.equal(duplicate.matrixRequestHash, null);
  });

  it("keeps request hashes while blocking ambiguous source evidence", () => {
    const fixture = crossMarketSimulationFixture();
    fixture.priceRows.push({ ...fixture.priceRows[0] });
    const result = composeSimulationReturnMatrixUniverseEvidence({
      request: request(),
      queryRange: planSimulationReturnMatrixUniverseRead(request()).queryRange,
      priceRows: fixture.priceRows,
      fxRows: fixture.fxRows,
    });

    assert.equal(result.status, "blocked");
    assert.equal(result.vectorReviewStatus, "blocked_until_matrix_ready");
    assert.match(result.scenarioUniverseHash, /^sha256:[0-9a-f]{64}$/);
    assert.match(result.matrixRequestHash, /^sha256:[0-9a-f]{64}$/);
    assert.ok(
      result.blockers.some(
        (blocker) => blocker.reason === "duplicate_price_date",
      ),
    );
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
    assert.equal(second.scenarioUniverseHash, first.scenarioUniverseHash);
    assert.equal(second.matrixRequestHash, first.matrixRequestHash);
  });

  it("keeps universe identity reusable while binding matrix requests to exact service dates", () => {
    const instruments = [
      {
        instrumentKey: "korea|KRW|069500",
        market: "korea",
        currency: "KRW",
        ticker: "069500",
      },
      {
        instrumentKey: "us|USD|VOO",
        market: "us",
        currency: "USD",
        ticker: "VOO",
      },
    ];
    const scenarioUniverseHash = hashSimulationScenarioUniverse(
      canonicalizeSimulationScenarioUniverse({ instruments }),
    );
    const reorderedUniverseHash = hashSimulationScenarioUniverse(
      canonicalizeSimulationScenarioUniverse({
        instruments: [...instruments].reverse(),
      }),
    );
    const first = hashSimulationReturnMatrixRequest(
      canonicalizeSimulationReturnMatrixRequest({
        scenarioUniverseHash,
        requestedServiceDates: ["2026-07-04", "2026-07-07"],
      }),
    );
    const second = hashSimulationReturnMatrixRequest(
      canonicalizeSimulationReturnMatrixRequest({
        scenarioUniverseHash,
        requestedServiceDates: ["2026-07-04", "2026-07-08"],
      }),
    );

    assert.match(scenarioUniverseHash, /^sha256:[0-9a-f]{64}$/);
    assert.equal(reorderedUniverseHash, scenarioUniverseHash);
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
      /private-price|private-fx|legacyBase44|weightBps|quantity|currentValue|matrixUniverseHash|inputMatrixHash|drawPlanHash|652b9ea/i,
    );
    assert.doesNotMatch(serialized, /"matrix"|"value"|adjustedClosePrice/i);
  });

  it("keeps the production adapter server-only, read-only, and projection-minimized", () => {
    const source = readFileSync(
      "src/db/queries/simulation-return-matrix.ts",
      "utf8",
    );
    const evidenceSource = readFileSync(
      "src/lib/simulation-return-matrix-universe-evidence.ts",
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
    assert.doesNotMatch(
      evidenceSource,
      /SIMULATION_PORTFOLIO_PATH_GATE0_APPROVAL_COMMIT|652b9ea/i,
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
