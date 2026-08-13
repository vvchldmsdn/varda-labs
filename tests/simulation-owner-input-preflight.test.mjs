import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS } from "../src/lib/investment-lab-special-holding-authority.ts";
import { buildSimulationOwnerInputCandidate } from "../src/lib/simulation-owner-input-candidate.ts";
import { buildSimulationOwnerInputPreflightModel } from "../src/lib/simulation-owner-input-preflight.ts";

describe("simulation owner input preflight", () => {
  it("aggregates owner holdings, excludes Fount, and preserves a zero-bps row", () => {
    const candidate = buildSimulationOwnerInputCandidate({
      account: "all",
      portfolio: portfolio({
        selectedAccount: "all",
        holdingRows: [
          holding({ ticker: "069500", account: "brokerage", value: 600 }),
          holding({ ticker: "069500", account: "isa", value: 400 }),
          goldHolding(200),
          holding({ ticker: "TINY", account: "irp", value: 0.01 }),
          fountHolding(500),
        ],
      }),
    });

    assert.equal(candidate.status, "ready_for_historical_preflight");
    assert.equal(candidate.summary.sourceHoldingCount, 5);
    assert.equal(candidate.summary.fountExcludedHoldingCount, 1);
    assert.equal(candidate.summary.fountExcludedCurrentValueKrw, 500);
    assert.equal(candidate.summary.aggregatedInstrumentCount, 3);
    assert.equal(candidate.summary.totalWeightBps, 10_000);
    assert.equal(candidate.selection?.totalWeightBps, 10_000);

    const kodex = candidate.instruments.find(
      (row) => row.instrumentKey === "korea|KRW|069500",
    );
    assert.deepEqual(kodex?.accounts, ["brokerage", "isa"]);
    assert.equal(kodex?.currentValueKrw, 1_000);
    assert.equal(
      candidate.instruments.find((row) => row.ticker === "TINY")?.weightBps,
      0,
    );
    assert.ok(
      candidate.instruments.some(
        (row) => row.instrumentKey === "krx-gold|KRW|GOLD_9999_1KG",
      ),
    );
  });

  it("keeps physical gold visible as a manual-history partial blocker", () => {
    const candidate = buildSimulationOwnerInputCandidate({
      account: "brokerage",
      portfolio: portfolio({
        selectedAccount: "brokerage",
        holdingRows: [
          holding({ ticker: "069500", account: "brokerage", value: 800 }),
          { ...goldHolding(200), ticker: "GOLD" },
        ],
      }),
    });
    const historicalPreflight = {
      requestedEndServiceDate: "2026-07-31",
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
    };

    const model = buildSimulationOwnerInputPreflightModel({
      candidate,
      historicalPreflight,
    });

    assert.equal(model.status, "partial_modeled_subset");
    assert.equal(model.evidenceSummary?.admittedWeightBps, 8_000);
    assert.equal(model.evidenceSummary?.manualHistoryRequiredWeightBps, 2_000);
    assert.equal(
      model.instruments.find(
        (row) => row.classification === "physical_commodity_position",
      )?.historicalStatus,
      "manual_history_required",
    );
  });

  it("blocks vector derivation without dropping valuation-gap diagnostics", () => {
    const gap = exclusion({ ticker: "QQQ", account: "brokerage" });
    const candidate = buildSimulationOwnerInputCandidate({
      account: "brokerage",
      portfolio: portfolio({
        selectedAccount: "brokerage",
        holdingRows: [
          holding({ ticker: "069500", account: "brokerage", value: 1_000 }),
        ],
        exclusions: [gap],
      }),
    });

    assert.equal(candidate.status, "diagnostics_only");
    assert.equal(candidate.selection, null);
    assert.deepEqual(candidate.blockers, ["valuation_evidence_incomplete"]);
    assert.deepEqual(candidate.valuationGaps, [
      {
        name: gap.name,
        account: gap.account,
        market: gap.market,
        currency: gap.currency,
        ticker: gap.ticker,
        reason: gap.reason,
      },
    ]);
  });

  it("blocks a mismatched server account scope", () => {
    const candidate = buildSimulationOwnerInputCandidate({
      account: "isa",
      portfolio: portfolio({
        selectedAccount: "brokerage",
        holdingRows: [
          holding({ ticker: "069500", account: "brokerage", value: 1_000 }),
        ],
      }),
    });

    assert.equal(candidate.selection, null);
    assert.deepEqual(candidate.blockers, ["account_scope_mismatch"]);
  });

  it("accepts an owner-resolved portfolio group without treating all-account query shape as a mismatch", () => {
    const scopeKey =
      "portfolio:11111111-1111-4111-8111-111111111111";
    const candidate = buildSimulationOwnerInputCandidate({
      scopeKey,
      portfolio: portfolio({
        selectedAccount: "all",
        holdingRows: [
          holding({ ticker: "069500", account: "brokerage", value: 1_000 }),
        ],
      }),
    });

    assert.equal(candidate.account, scopeKey);
    assert.equal(candidate.status, "ready_for_historical_preflight");
    assert.deepEqual(candidate.blockers, []);
    assert.equal(candidate.selection?.totalWeightBps, 10_000);
  });

  it("preserves unresolved positive holdings as visible diagnostics", () => {
    const candidate = buildSimulationOwnerInputCandidate({
      account: "brokerage",
      portfolio: portfolio({
        selectedAccount: "brokerage",
        holdingRows: [
          holding({ ticker: "069500", account: "brokerage", value: 900 }),
          holding({
            ticker: null,
            account: "brokerage",
            value: 100,
            name: "Unresolved holding",
            assetType: "stock",
          }),
        ],
      }),
    });

    assert.equal(candidate.selection, null);
    assert.deepEqual(candidate.blockers, ["instrument_identity_unresolved"]);
    assert.deepEqual(candidate.identityGaps, [
      {
        name: "Unresolved holding",
        account: "brokerage",
        market: "korea",
        currency: "KRW",
        ticker: null,
        currentValueKrw: 100,
      },
    ]);
  });
});

function portfolio({
  selectedAccount,
  holdingRows = [],
  exclusions = [],
}) {
  return {
    selectedAccount,
    usdKrwRate: 1_500,
    totalValueKrw: holdingRows.reduce((sum, row) => sum + row.currentValueKrw, 0),
    includedHoldingCount: holdingRows.length,
    excludedHoldingCount: exclusions.length,
    holdingRows,
    groupRows: [],
    exclusions,
    dataHealth: {
      inputAssetCount: holdingRows.length + exclusions.length,
      selectedAssetCount: holdingRows.length + exclusions.length,
      includedHoldingCount: holdingRows.length,
      excludedHoldingCount: exclusions.length,
      missingPriceCount: exclusions.length,
      missingFxCount: 0,
      unsupportedCurrencyCount: 0,
      unresolvedTargetPolicyCount: 0,
    },
  };
}

function holding({
  ticker,
  account,
  value,
  name = ticker,
  market = "korea",
  currency = "KRW",
  assetType = "etf",
}) {
  return {
    name,
    ticker,
    account,
    market,
    currency,
    assetType,
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

function fountHolding(value) {
  const decision = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.fount;
  return holding({
    ticker: null,
    account: decision.account,
    value,
    name: decision.assetName,
    market: decision.market,
    currency: decision.currency,
    assetType: decision.assetType,
  });
}

function goldHolding(value) {
  const decision = DECISION_SUPPORT_SPECIAL_HOLDING_DECISIONS.decisions.krxGold;
  return holding({
    ticker: null,
    account: decision.account,
    value,
    name: decision.assetName,
    market: decision.market,
    currency: decision.currency,
    assetType: decision.assetType,
  });
}

function exclusion({ ticker, account }) {
  return {
    reason: "missing_price",
    name: ticker,
    ticker,
    account,
    market: "us",
    currency: "USD",
    assetType: "etf",
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: null,
  };
}
