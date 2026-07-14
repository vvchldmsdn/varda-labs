import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSimulationInputReadiness,
  buildSimulationInputReadinessDates,
  resolveSimulationEndServiceDateSelection,
} from "../src/lib/simulation-input-readiness.ts";
import {
  loadSimulationPeriodPreflight,
  loadSimulationPeriodPreflightBatch,
} from "../src/lib/simulation-period-preflight-loader.ts";
import { planSimulationPeriodPreflightScan } from "../src/lib/simulation-period-preflight-plan.ts";
import { shiftRiskDate } from "../src/lib/portfolio-risk-calendar.ts";
import { SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";

const END_SERVICE_DATE = "2026-07-09";
const RETURN_STEP_COUNT = 90;

describe("Simulation input readiness read model", () => {
  it("projects independent KODEX 200 and VOO matrix readiness", async () => {
    const fixture = completeFixture();
    const [kodex200, voo] = await Promise.all([
      loadSimulationPeriodPreflight(
        repository(fixture),
        request(descriptors.kodex200),
      ),
      loadSimulationPeriodPreflight(
        repository(fixture),
        request(descriptors.voo),
      ),
    ]);
    const model = buildSimulationInputReadiness({
      requestedEndServiceDate: END_SERVICE_DATE,
      generatedAt: "2026-07-09T07:00:00.000Z",
      inputs: [
        { descriptor: descriptors.kodex200, preflight: kodex200 },
        { descriptor: descriptors.voo, preflight: voo },
      ],
    });

    assert.equal(model.summary.readyInputCount, 2);
    assert.equal(model.summary.returnStepCount, 90);
    assert.deepEqual(
      model.inputs.map((row) => [
        row.id,
        row.status,
        row.returnCoverage?.readyReturnCount,
        row.fxCoverage?.coveredServiceDateCount ?? null,
      ]),
      [
        ["kodex200", "matrix_ready", 90, null],
        ["voo", "matrix_ready", 90, 91],
      ],
    );
    assert.ok(model.inputs.every((row) => row.issues.length === 0));
    for (const input of model.inputs) {
      assert.equal(input.observedReturns?.length, RETURN_STEP_COUNT);
      assert.ok(
        input.observedReturns.every(
          (row, index, series) =>
            Number.isFinite(row.value) &&
            (index === 0 ||
              series[index - 1].serviceDate === row.previousServiceDate),
        ),
      );
    }
    const vooLastReturn = model.inputs[1].observedReturns.at(-1).value;
    const expectedVooLastReturn = (290 * 1_390) / (289 * 1_389) - 1;
    assert.ok(
      Math.abs(vooLastReturn - expectedVooLastReturn) < 1e-12,
      "VOO KRW returns must include the date-specific FX ratio",
    );
  });

  it("keeps an exact missing endpoint unavailable and exposes only the prior date as review evidence", async () => {
    const fixture = completeFixture();
    const preflight = await loadSimulationPeriodPreflight(repository(fixture), {
      ...request(descriptors.voo),
      endServiceDate: "2026-07-10",
    });
    const model = buildSimulationInputReadiness({
      requestedEndServiceDate: "2026-07-10",
      generatedAt: "2026-07-10T07:00:00.000Z",
      inputs: [{ descriptor: descriptors.voo, preflight }],
    });

    assert.equal(model.inputs[0].status, "unavailable");
    assert.equal(model.inputs[0].resolvedEndServiceDate, null);
    assert.equal(model.inputs[0].observedReturns, null);
    assert.equal(
      model.inputs[0].nearestPriorObservedServiceDate,
      END_SERVICE_DATE,
    );
    assert.ok(
      model.inputs[0].issues.some(
        (issue) => issue.code === "end_service_date_not_observed",
      ),
    );
  });

  it("does not expose matrix hashes, prices, FX values, or internal identifiers", async () => {
    const fixture = completeFixture();
    const preflight = await loadSimulationPeriodPreflight(
      repository(fixture),
      request(descriptors.voo),
    );
    const serialized = JSON.stringify(
      buildSimulationInputReadiness({
        requestedEndServiceDate: END_SERVICE_DATE,
        generatedAt: "2026-07-09T07:00:00.000Z",
        inputs: [{ descriptor: descriptors.voo, preflight }],
      }),
    );

    assert.doesNotMatch(
      serialized,
      /scenarioUniverseHash|matrixRequestHash|inputMatrixHash|drawPlanHash|adjustedClosePrice|usdKrw|instrumentKey|sourcePriceDate|sourceFxDate|legacyBase44|ownerUser|assetId|holdingId/i,
    );
  });

  it("distinguishes an absent end query from supplied invalid values", () => {
    assert.deepEqual(
      resolveSimulationEndServiceDateSelection({
        suppliedValue: undefined,
        defaultEndServiceDate: END_SERVICE_DATE,
      }),
      {
        status: "valid",
        source: "server_default",
        endServiceDate: END_SERVICE_DATE,
      },
    );
    assert.deepEqual(
      resolveSimulationEndServiceDateSelection({
        suppliedValue: END_SERVICE_DATE,
        defaultEndServiceDate: "2026-07-10",
      }),
      {
        status: "valid",
        source: "query",
        endServiceDate: END_SERVICE_DATE,
      },
    );

    for (const suppliedValue of [
      "",
      " ",
      ` ${END_SERVICE_DATE}`,
      `${END_SERVICE_DATE} `,
      "2026-02-30",
      "2026/07/09",
      [END_SERVICE_DATE],
      [END_SERVICE_DATE, "2026-07-08"],
    ]) {
      assert.deepEqual(
        resolveSimulationEndServiceDateSelection({
          suppliedValue,
          defaultEndServiceDate: END_SERVICE_DATE,
        }),
        {
          status: "invalid",
          source: "query",
          endServiceDate: "",
        },
      );
    }
  });

  it("builds a bounded seven-day exact-date history without fallback", () => {
    assert.deepEqual(buildSimulationInputReadinessDates(END_SERVICE_DATE), [
      "2026-07-09",
      "2026-07-08",
      "2026-07-07",
      "2026-07-06",
      "2026-07-05",
      "2026-07-04",
      "2026-07-03",
    ]);
    assert.deepEqual(buildSimulationInputReadinessDates("invalid"), []);
  });

  it("performs no repository reads when every batch request is invalid", async () => {
    const calls = { price: 0, fx: 0 };
    const result = await loadSimulationPeriodPreflightBatch(
      countingRepository(completeFixture(), calls),
      [descriptors.kodex200, descriptors.voo].map((descriptor) => ({
        ...request(descriptor),
        endServiceDate: "",
      })),
    );

    assert.equal(calls.price, 0);
    assert.equal(calls.fx, 0);
    assert.deepEqual(
      result.map((row) => row.status),
      ["axis_blocked", "axis_blocked"],
    );
  });

  it("loads one bounded snapshot for multiple independent preflights", async () => {
    const calls = { price: 0, fx: 0, priceInputs: [] };
    const kodexRequest = request(descriptors.kodex200);
    const result = await loadSimulationPeriodPreflightBatch(
      countingRepository(completeFixture(), calls),
      [
        kodexRequest,
        request(descriptors.voo),
      ],
    );
    const plan = planSimulationPeriodPreflightScan(kodexRequest);

    assert.equal(calls.price, 1);
    assert.equal(calls.fx, 1);
    assert.equal(
      calls.priceInputs[0].sourceDateFrom,
      shiftRiskDate(
        plan.queryRange.sourceDateFrom,
        -SIMULATION_RETURN_MATRIX_POLICY.maxPriceCarryDays,
      ),
    );
    assert.deepEqual(
      result.map((row) => row.status),
      ["matrix_ready", "matrix_ready"],
    );
  });
});

const descriptors = {
  kodex200: {
    id: "kodex200",
    name: "KODEX 200",
    ticker: "069500",
    market: "korea",
    marketLabel: "한국",
    currency: "KRW",
    priceBasisLabel: "저장된 조정종가",
    fxBasisLabel: "환율 불필요",
  },
  voo: {
    id: "voo",
    name: "Vanguard S&P 500 ETF",
    ticker: "VOO",
    market: "us",
    marketLabel: "미국",
    currency: "USD",
    priceBasisLabel: "저장된 조정종가",
    fxBasisLabel: "기준일별 저장 USD/KRW",
  },
};

function request(descriptor) {
  return {
    candidates: [
      {
        displayName: descriptor.name,
        market: descriptor.market,
        currency: descriptor.currency,
        ticker: descriptor.ticker,
      },
    ],
    endServiceDate: END_SERVICE_DATE,
    returnStepCount: RETURN_STEP_COUNT,
  };
}

function completeFixture() {
  const sourceDates = calendarDates("2026-04-09", 91);
  return {
    priceRows: sourceDates.flatMap((priceDate, index) => [
      {
        market: "korea",
        currency: "KRW",
        ticker: "069500",
        priceDate,
        adjustedClosePrice: 100 + index,
      },
      {
        market: "us",
        currency: "USD",
        ticker: "VOO",
        priceDate,
        adjustedClosePrice: 200 + index,
      },
    ]),
    fxRows: sourceDates.map((rateDate, index) => ({
      rateDate,
      usdKrw: 1_300 + index,
      status: "ok",
    })),
  };
}

function repository(fixture) {
  return {
    async loadPriceRows(input) {
      const identities = new Set(
        input.instruments.map(
          (row) => `${row.market}|${row.currency}|${row.ticker}`,
        ),
      );
      return fixture.priceRows.filter(
        (row) =>
          identities.has(`${row.market}|${row.currency}|${row.ticker}`) &&
          row.priceDate >= input.sourceDateFrom &&
          row.priceDate <= input.sourceDateTo,
      );
    },
    async loadFxRows(input) {
      return fixture.fxRows.filter(
        (row) =>
          row.rateDate >= input.sourceDateFrom &&
          row.rateDate <= input.sourceDateTo,
      );
    },
  };
}

function countingRepository(fixture, calls) {
  const delegate = repository(fixture);
  return {
    async loadPriceRows(input) {
      calls.price += 1;
      calls.priceInputs?.push(input);
      return delegate.loadPriceRows(input);
    },
    async loadFxRows(input) {
      calls.fx += 1;
      return delegate.loadFxRows(input);
    },
  };
}

function calendarDates(startDate, count) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  for (let index = 0; index < count; index += 1) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}
