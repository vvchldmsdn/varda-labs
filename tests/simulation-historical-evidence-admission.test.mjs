import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADJUSTED_CLOSE_BASIS } from "../src/lib/market-data/providers/types.ts";
import {
  admitSimulationHistoricalEvidence,
} from "../src/lib/simulation-historical-evidence-admission.ts";
import { summarizeSimulationPortfolioHistoricalEvidence } from "../src/lib/simulation-portfolio-historical-evidence-summary.ts";

const SERVICE_DATES = ["2026-07-04", "2026-07-07", "2026-07-08"];

describe("Simulation historical evidence admission", () => {
  it("admits exact provider-adjusted Korean evidence", () => {
    const admission = admitSimulationHistoricalEvidence({
      classification: "listed_instrument",
      instrument: instrument("korea", "KRW", "069500"),
      providerBinding: providerBinding("069500", "KRX"),
      requestedServiceDates: SERVICE_DATES,
      priceRows: [
        price("korea", "KRW", "069500", "2026-07-03", 100, "069500", "KRX"),
        price("korea", "KRW", "069500", "2026-07-06", 101, "069500", "KRX"),
        price("korea", "KRW", "069500", "2026-07-07", 102, "069500", "KRX"),
      ],
      fxRows: [],
    });

    assert.equal(admission.status, "ready");
    assert.equal(admission.instrumentKey, "korea|KRW|069500");
    assert.equal(admission.evidence.coveragePct, 100);
    assert.equal(admission.evidence.incompleteCellCount, 0);
  });

  it("does not admit raw or unverified close evidence as adjusted close", () => {
    const admission = admitSimulationHistoricalEvidence({
      classification: "listed_instrument",
      instrument: instrument("korea", "KRW", "069500"),
      providerBinding: providerBinding("069500", "KRX"),
      requestedServiceDates: SERVICE_DATES,
      priceRows: [
        {
          ...price(
            "korea",
            "KRW",
            "069500",
            "2026-07-03",
            100,
            "069500",
            "KRX",
          ),
          adjustedCloseBasis: "raw_close",
        },
      ],
      fxRows: [],
    });

    assert.equal(admission.status, "price_basis_ineligible");
    assert.deepEqual(admission.issues, ["adjusted_close_basis_ineligible"]);
    assert.equal(admission.matrix, null);
  });

  it("keeps USD price evidence but reports incomplete FX separately", () => {
    const admission = admitSimulationHistoricalEvidence({
      classification: "listed_instrument",
      instrument: instrument("us", "USD", "QQQ"),
      providerBinding: providerBinding("QQQ", "NAS"),
      requestedServiceDates: SERVICE_DATES,
      priceRows: [
        price("us", "USD", "QQQ", "2026-07-02", 100, "QQQ", "NAS"),
        price("us", "USD", "QQQ", "2026-07-06", 101, "QQQ", "NAS"),
        price("us", "USD", "QQQ", "2026-07-07", 102, "QQQ", "NAS"),
      ],
      fxRows: [],
    });

    assert.equal(admission.status, "fx_incomplete");
    assert.ok(admission.issues.includes("fx_incomplete"));
    assert.ok(admission.evidence.incompleteCellCount > 0);
    assert.notEqual(admission.matrix, null);
  });

  it("preserves explicit Fount and physical gold exclusions", () => {
    const managed = admitSimulationHistoricalEvidence({
      classification: "managed_sleeve",
      instrument: instrument("korea", "KRW", null),
      providerBinding: null,
      requestedServiceDates: SERVICE_DATES,
      priceRows: [],
      fxRows: [],
    });
    const gold = admitSimulationHistoricalEvidence({
      classification: "physical_commodity_position",
      instrument: instrument("korea", "KRW", null),
      providerBinding: null,
      requestedServiceDates: SERVICE_DATES,
      priceRows: [],
      fxRows: [],
    });

    assert.equal(managed.status, "excluded_by_policy");
    assert.equal(gold.status, "manual_history_required");
  });

  it("allows an explicitly labelled eligible subset but never relabels an incomplete modeled subset", () => {
    const ready = admitSimulationHistoricalEvidence({
      classification: "listed_instrument",
      instrument: instrument("korea", "KRW", "069500"),
      providerBinding: providerBinding("069500", "KRX"),
      requestedServiceDates: SERVICE_DATES,
      priceRows: [
        price("korea", "KRW", "069500", "2026-07-03", 100, "069500", "KRX"),
        price("korea", "KRW", "069500", "2026-07-06", 101, "069500", "KRX"),
        price("korea", "KRW", "069500", "2026-07-07", 102, "069500", "KRX"),
      ],
      fxRows: [],
    });
    const fount = admitSimulationHistoricalEvidence({
      classification: "managed_sleeve",
      instrument: instrument("korea", "KRW", null),
      providerBinding: null,
      requestedServiceDates: SERVICE_DATES,
      priceRows: [],
      fxRows: [],
    });
    const gold = admitSimulationHistoricalEvidence({
      classification: "physical_commodity_position",
      instrument: instrument("korea", "KRW", null),
      providerBinding: null,
      requestedServiceDates: SERVICE_DATES,
      priceRows: [],
      fxRows: [],
    });
    const incomplete = admitSimulationHistoricalEvidence({
      classification: "listed_instrument",
      instrument: instrument("us", "USD", "QQQ"),
      providerBinding: providerBinding("QQQ", "NAS"),
      requestedServiceDates: SERVICE_DATES,
      priceRows: [
        price("us", "USD", "QQQ", "2026-07-02", 100, "QQQ", "NAS"),
      ],
      fxRows: [],
    });

    const eligibleSubset = summarizeSimulationPortfolioHistoricalEvidence([
      { weightBps: 8_000, admission: ready },
      { weightBps: 2_000, admission: fount },
    ]);
    assert.equal(eligibleSubset.status, "ready_eligible_subset");
    assert.equal(eligibleSubset.displayAuthority, "eligible_instrument_subset");
    assert.equal(eligibleSubset.explicitlyExcludedWeightBps, 2_000);
    assert.equal(eligibleSubset.manualHistoryRequiredWeightBps, 0);

    const goldBlockedSubset =
      summarizeSimulationPortfolioHistoricalEvidence([
        { weightBps: 8_000, admission: ready },
        { weightBps: 2_000, admission: gold },
      ]);
    assert.equal(goldBlockedSubset.status, "partial_modeled_subset");
    assert.equal(
      goldBlockedSubset.displayAuthority,
      "partial_modeled_instrument_subset",
    );
    assert.equal(
      goldBlockedSubset.consumerAuthority,
      "partial_subset_research_only",
    );
    assert.equal(
      goldBlockedSubset.weightPolicy,
      "preserve_original_weight_mass_without_renormalization",
    );
    assert.ok(
      goldBlockedSubset.forbiddenConsumers.includes(
        "current_portfolio_label",
      ),
    );
    assert.ok(goldBlockedSubset.forbiddenConsumers.includes("optimizer"));
    assert.equal(goldBlockedSubset.explicitlyExcludedWeightBps, 0);
    assert.equal(goldBlockedSubset.manualHistoryRequiredWeightBps, 2_000);
    assert.equal(goldBlockedSubset.incompleteModeledWeightBps, 2_000);
    assert.ok(
      goldBlockedSubset.blockers.includes("manual_history_required"),
    );

    const blockedSubset = summarizeSimulationPortfolioHistoricalEvidence([
      { weightBps: 5_000, admission: ready },
      { weightBps: 5_000, admission: incomplete },
    ]);
    assert.equal(blockedSubset.status, "partial_modeled_subset");
    assert.equal(
      blockedSubset.displayAuthority,
      "partial_modeled_instrument_subset",
    );
    assert.equal(blockedSubset.diagnosticStatus, "partial");
    assert.equal(blockedSubset.incompleteModeledWeightBps, 5_000);
    assert.ok(
      blockedSubset.forbiddenConsumers.includes(
        "current_vs_candidate_comparison",
      ),
    );
  });
});

function instrument(market, currency, ticker) {
  return { market, currency, ticker };
}

function providerBinding(symbol, exchange) {
  return { provider: "fixture_provider", symbol, exchange };
}

function price(
  market,
  currency,
  ticker,
  priceDate,
  adjustedClosePrice,
  providerSymbol,
  providerExchange,
) {
  return {
    market,
    currency,
    ticker,
    priceDate,
    adjustedClosePrice,
    adjustedCloseBasis: ADJUSTED_CLOSE_BASIS.provider,
    adjustedCloseProvider: "fixture_provider",
    adjustedCloseSource: "fixture_provider_adjusted_history",
    adjustedCloseFetchedAt: "2026-07-10T00:00:00.000Z",
    providerSymbol,
    providerExchange,
  };
}
