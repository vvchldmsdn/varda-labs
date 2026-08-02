import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { allocateBasisPointsByValue } from "../src/lib/basis-point-allocation.ts";
import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/investment-lab-special-holding-authority.ts";
import { buildSimulationOwnerInputCandidate } from "../src/lib/simulation-owner-input-candidate.ts";
import { buildSimulationOwnerInputPreflightModel } from "../src/lib/simulation-owner-input-preflight.ts";
import {
  SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY,
  buildSimulationOwnerResearchExecution,
  resolveSimulationOwnerExecutionEndSelection,
} from "../src/lib/simulation-owner-research-execution.ts";
import { resolveSimulationResearchHorizon } from "../src/lib/simulation-research-horizon.ts";
import { SIMULATION_RETURN_MATRIX_POLICY } from "../src/lib/simulation-return-matrix.ts";

describe("owner-scoped portfolio research execution", () => {
  it("allocates equal remainders deterministically by canonical key", () => {
    const left = allocateBasisPointsByValue([
      { key: "C", value: 1 },
      { key: "A", value: 1 },
      { key: "B", value: 1 },
    ]);
    const right = allocateBasisPointsByValue([
      { key: "B", value: 1 },
      { key: "C", value: 1 },
      { key: "A", value: 1 },
    ]);

    assert.deepEqual([...left.entries()].sort(), [
      ["A", 3_334],
      ["B", 3_333],
      ["C", 3_333],
    ]);
    assert.deepEqual([...right.entries()].sort(), [...left.entries()].sort());
  });

  it("uses an exact query date or the latest common stored date without fallback", () => {
    assert.deepEqual(
      resolveSimulationOwnerExecutionEndSelection({
        suppliedValue: "2026-07-10",
        latestCommonStoredServiceDate: "2026-07-09",
      }),
      {
        status: "valid",
        source: "query",
        endServiceDate: "2026-07-10",
      },
    );
    assert.deepEqual(
      resolveSimulationOwnerExecutionEndSelection({
        suppliedValue: undefined,
        latestCommonStoredServiceDate: "2026-07-09",
      }),
      {
        status: "valid",
        source: "latest_common_stored",
        endServiceDate: "2026-07-09",
      },
    );
    assert.equal(
      resolveSimulationOwnerExecutionEndSelection({
        suppliedValue: ["2026-07-09", "2026-07-10"],
        latestCommonStoredServiceDate: "2026-07-09",
      }).status,
      "invalid",
    );
    assert.equal(
      resolveSimulationOwnerExecutionEndSelection({
        suppliedValue: undefined,
        latestCommonStoredServiceDate: null,
      }).status,
      "unavailable",
    );
  });

  it("executes a full listed ISA composition from the exact 90-row matrix", () => {
    const candidate = buildSimulationOwnerInputCandidate({
      account: "isa",
      portfolio: portfolio({
        selectedAccount: "isa",
        holdingRows: [
          holding({ ticker: "133690", account: "isa", value: 600 }),
          holding({ ticker: "360200", account: "isa", value: 400 }),
        ],
      }),
    });
    const inputPreflight = readyInputPreflight(candidate);
    const matrix = readyMatrix(
      candidate.instruments.filter((row) => row.weightBps > 0),
    );
    const result = buildSimulationOwnerResearchExecution({
      candidate,
      inputPreflight,
      endSelection: {
        status: "valid",
        source: "latest_common_stored",
        endServiceDate: matrix.requestedServiceDates.at(-1),
      },
      horizonSelection: resolveSimulationResearchHorizon(undefined),
      matrix,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.modeledCurrentValuePct, 100);
    assert.equal(result.coverage.omittedWeightBps, 0);
    assert.equal(result.assumptions.horizon, 63);
    assert.equal(result.assumptions.pathCount, 500);
    assert.deepEqual(
      result.executionWeights.map(({ ticker, weightBps }) => ({
        ticker,
        weightBps,
      })),
      [
        { ticker: "133690", weightBps: 6_000 },
        { ticker: "360200", weightBps: 4_000 },
      ],
    );
    assert.equal(result.bands.length, 64);
    assert.equal(result.samplePaths.length, 12);
    assert.equal(result.policy.persistence, "forbidden");
    assert.equal(result.policy.providerCalls, "forbidden");
  });

  it("runs the listed subset while disclosing KRX Gold instead of backcasting it", () => {
    const candidate = buildSimulationOwnerInputCandidate({
      account: "brokerage",
      portfolio: portfolio({
        selectedAccount: "brokerage",
        holdingRows: [
          holding({ ticker: "069500", account: "brokerage", value: 800 }),
          goldHolding(200),
        ],
      }),
    });
    const inputPreflight = readyInputPreflight(candidate);
    const matrix = readyMatrix(
      candidate.instruments.filter(
        (row) => row.classification === "listed_instrument" && row.weightBps > 0,
      ),
    );
    const result = buildSimulationOwnerResearchExecution({
      candidate,
      inputPreflight,
      endSelection: {
        status: "valid",
        source: "query",
        endServiceDate: matrix.requestedServiceDates.at(-1),
      },
      horizonSelection: resolveSimulationResearchHorizon("126"),
      matrix,
    });

    assert.equal(result.status, "ready");
    assert.equal(result.coverage.modeledCurrentValuePct, 80);
    assert.equal(result.coverage.modeledOriginalWeightBps, 8_000);
    assert.equal(result.coverage.omittedWeightBps, 2_000);
    assert.equal(result.coverage.manualHistoryWeightBps, 2_000);
    assert.deepEqual(
      result.executionWeights.map(({ ticker, weightBps }) => ({
        ticker,
        weightBps,
      })),
      [{ ticker: "069500", weightBps: 10_000 }],
    );
    assert.equal(result.assumptions.horizon, 126);
    assert.equal(
      result.instruments.find(
        (row) => row.executionRole === "omitted_manual_history",
      )?.historicalStatus,
      "manual_history_required",
    );
    assert.equal(
      SIMULATION_OWNER_RESEARCH_EXECUTION_POLICY.krxGoldPolicy,
      "omit_without_backcast_until_manual_history_exists",
    );
  });

  it("keeps diagnostics visible when the stochastic matrix is incomplete", () => {
    const candidate = buildSimulationOwnerInputCandidate({
      account: "isa",
      portfolio: portfolio({
        selectedAccount: "isa",
        holdingRows: [holding({ ticker: "133690", account: "isa", value: 1_000 })],
      }),
    });
    const inputPreflight = readyInputPreflight(candidate);
    const matrix = readyMatrix(candidate.instruments);
    const result = buildSimulationOwnerResearchExecution({
      candidate,
      inputPreflight,
      endSelection: {
        status: "valid",
        source: "latest_common_stored",
        endServiceDate: matrix.requestedServiceDates.at(-1),
      },
      horizonSelection: resolveSimulationResearchHorizon(undefined),
      matrix: {
        ...matrix,
        status: "incomplete",
        consumerStatus: "blocked_incomplete_matrix",
      },
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "input_matrix_unavailable");
    assert.equal(result.instruments.length, 1);
    assert.equal(result.instruments[0].historicalStatus, "provenance_ready_for_separate_review");
    assert.deepEqual(result.samplePaths, []);
  });

  it("blocks an explicit-date matrix when adjusted-history evidence is not admitted", () => {
    const candidate = buildSimulationOwnerInputCandidate({
      account: "isa",
      portfolio: portfolio({
        selectedAccount: "isa",
        holdingRows: [holding({ ticker: "133690", account: "isa", value: 1_000 })],
      }),
    });
    const readyPreflight = readyInputPreflight(candidate);
    const inputPreflight = {
      ...readyPreflight,
      instruments: readyPreflight.instruments.map((row) => ({
        ...row,
        historicalStatus: "provenance_incomplete",
        admissionStatus: null,
        provenance: { status: "incomplete" },
      })),
    };
    const matrix = readyMatrix(candidate.instruments);
    const result = buildSimulationOwnerResearchExecution({
      candidate,
      inputPreflight,
      endSelection: {
        status: "valid",
        source: "query",
        endServiceDate: matrix.requestedServiceDates.at(-1),
      },
      horizonSelection: resolveSimulationResearchHorizon(undefined),
      matrix,
    });

    assert.equal(result.status, "unavailable");
    assert.equal(result.reason, "historical_evidence_not_admitted");
    assert.equal(result.instruments[0].historicalStatus, "provenance_incomplete");
    assert.deepEqual(result.samplePaths, []);
  });
});

function readyInputPreflight(candidate) {
  return buildSimulationOwnerInputPreflightModel({
    candidate,
    historicalPreflight: {
      requestedEndServiceDate: "2026-04-01",
      instruments: candidate.instruments.map((row) =>
        row.classification === "physical_commodity_position"
          ? {
              instrumentKey: row.instrumentKey,
              status: "manual_history_required",
              admissionStatus: "manual_history_required",
              storedCoverage: null,
              provenance: null,
            }
          : {
              instrumentKey: row.instrumentKey,
              status: "provenance_ready_for_separate_review",
              admissionStatus: "ready",
              storedCoverage: { status: "ready" },
              provenance: { status: "complete" },
            },
      ),
    },
  });
}

function readyMatrix(instruments) {
  const requestedServiceDates = Array.from({ length: 91 }, (_, index) =>
    isoDate(index),
  );
  const matrixInstruments = instruments.map((row) => ({
    instrumentKey: row.instrumentKey,
    market: row.market,
    currency: row.currency,
    ticker: row.ticker,
  }));
  const matrix = Array.from({ length: 90 }, (_, index) => ({
    previousServiceDate: requestedServiceDates[index],
    serviceDate: requestedServiceDates[index + 1],
    cells: matrixInstruments.map((instrument, instrumentIndex) => ({
      instrumentKey: instrument.instrumentKey,
      value: 0.001 + ((index + instrumentIndex) % 7) * 0.0005,
      previous: evidence(requestedServiceDates[index]),
      current: evidence(requestedServiceDates[index + 1]),
    })),
  }));

  return {
    status: "ready",
    policy: SIMULATION_RETURN_MATRIX_POLICY,
    requestedServiceDates,
    instruments: matrixInstruments,
    exclusions: [],
    matrix,
    summary: {
      requestedInstrumentCount: matrixInstruments.length,
      includedInstrumentCount: matrixInstruments.length,
      excludedInstrumentCount: 0,
      requestedServiceDateCount: requestedServiceDates.length,
      matrixRowCount: matrix.length,
      totalCellCount: matrix.length * matrixInstruments.length,
      readyCellCount: matrix.length * matrixInstruments.length,
      incompleteCellCount: 0,
      coveragePct: 100,
    },
    sourceSummary: {
      acceptedPriceRows: requestedServiceDates.length * matrixInstruments.length,
      acceptedFxRows: 0,
      ignoredOutOfWindowPriceRows: 0,
      ignoredOutOfWindowFxRows: 0,
    },
    consumerStatus: "matrix_ready",
    blockers: [],
  };
}

function portfolio({ selectedAccount, holdingRows }) {
  return {
    selectedAccount,
    usdKrwRate: 1_500,
    totalValueKrw: holdingRows.reduce((sum, row) => sum + row.currentValueKrw, 0),
    includedHoldingCount: holdingRows.length,
    excludedHoldingCount: 0,
    holdingRows,
    groupRows: [],
    exclusions: [],
    dataHealth: {
      inputAssetCount: holdingRows.length,
      selectedAssetCount: holdingRows.length,
      includedHoldingCount: holdingRows.length,
      excludedHoldingCount: 0,
      missingPriceCount: 0,
      missingFxCount: 0,
      unsupportedCurrencyCount: 0,
      unresolvedTargetPolicyCount: 0,
    },
  };
}

function holding({ ticker, account, value, name = ticker }) {
  return {
    name,
    ticker,
    account,
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: value,
    currentValueKrw: value,
    currentWeightPct: 0,
    rawAssetTargetPct: null,
    groupTargetPct: null,
    memberAllocationRatioPct: null,
    effectiveTargetPct: null,
    driftPct: null,
    targetPolicyStatus: "missing_target",
    priceEvidenceSource: "asset_current_price_fallback",
    priceSource: "manual",
    priceFetchedAt: null,
    priceAsOf: null,
  };
}

function goldHolding(value) {
  const decision = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
  return {
    ...holding({
      ticker: null,
      account: decision.account,
      value,
      name: decision.assetName,
    }),
    market: decision.market,
    currency: decision.currency,
    assetType: decision.assetType,
  };
}

function evidence(date) {
  return {
    status: "ready",
    reason: null,
    sourcePriceDate: date,
    priceCarryDays: 0,
    sourceFxDate: null,
    fxCarryDays: null,
  };
}

function isoDate(offset) {
  const date = new Date(Date.UTC(2026, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}
