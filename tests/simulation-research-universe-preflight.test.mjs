import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ADJUSTED_CLOSE_BASIS } from "../src/lib/market-data/providers/types.ts";
import {
  buildSimulationResearchUniversePreflight,
  resolveSimulationResearchUniverseSelection,
} from "../src/lib/simulation-research-universe-preflight.ts";

const SERVICE_DATES = ["2026-07-04", "2026-07-07", "2026-07-08"];

describe("Simulation research universe preflight", () => {
  it("normalizes one explicit 10,000 bps research universe", () => {
    const selection = resolveSimulationResearchUniverseSelection(
      " korea : krw : 069500 : 5000 , us : usd : qqq : 5000 ",
    );

    assert.equal(selection.status, "valid");
    assert.equal(selection.totalWeightBps, 10_000);
    assert.deepEqual(
      selection.instruments.map((row) => row.instrumentKey),
      ["korea|KRW|069500", "us|USD|QQQ"],
    );
    assert.deepEqual(
      selection.instruments.map((row) => row.weightBps),
      [5_000, 5_000],
    );
  });

  it("blocks repeated, duplicate, malformed, and non-10,000 bps input", () => {
    assert.deepEqual(
      resolveSimulationResearchUniverseSelection(["a", "b"]).issues,
      ["repeated_query"],
    );
    const duplicate = resolveSimulationResearchUniverseSelection(
      "korea:KRW:069500:5000,korea:KRW:069500:4000",
    );
    assert.equal(duplicate.status, "invalid");
    assert.ok(duplicate.issues.includes("duplicate_instrument"));
    assert.ok(duplicate.issues.includes("weight_total_not_10000"));

    const malformed = resolveSimulationResearchUniverseSelection(
      "korea:EUR:069500:10000",
    );
    assert.equal(malformed.status, "invalid");
    assert.ok(malformed.issues.includes("invalid_currency"));
  });

  it("preserves zero rows and special-holding policy without DB authority", () => {
    const selection = resolveSimulationResearchUniverseSelection(
      [
        "korea:KRW:069500:7000",
        "us:USD:QQQ:0",
        "managed:KRW:FOUNT:1000",
        "krx-gold:KRW:GOLD_9999_1KG:2000",
      ].join(","),
    );
    assert.equal(selection.status, "valid");

    const model = buildSimulationResearchUniversePreflight({
      selection,
      requestedEndServiceDate: "2026-07-08",
      preflight: preflight([
        matrixInstrument("korea|KRW|069500", "ready", "KRW"),
      ]),
      priceRows: qualifiedKoreanRows(),
      fxRows: [],
    });

    assert.equal(model.status, "partial_diagnostics_only");
    assert.equal(model.runtimeTrustStatus, "not_established");
    assert.deepEqual(
      model.instruments.map((row) => row.status),
      [
        "provenance_ready_for_separate_review",
        "zero_weight_not_evaluated",
        "excluded_by_policy",
        "manual_history_required",
      ],
    );
    assert.equal(model.summary.provenanceReadyWeightBps, 7_000);
    assert.equal(model.summary.excludedWeightBps, 1_000);
    assert.equal(model.summary.manualHistoryRequiredWeightBps, 2_000);
    assert.equal(model.summary.incompleteWeightBps, 2_000);
  });

  it("requires exact reserved tuples for special-holding classification", () => {
    const selection = resolveSimulationResearchUniverseSelection(
      [
        "managed:KRW:FOUNT:1000",
        "managed:KRW:OTHER:1000",
        "us:USD:FOUNT:1000",
        "krx-gold:KRW:GOLD_9999_1KG:1000",
        "krx-gold:KRW:OTHER:1000",
        "korea:KRW:GOLD_9999_1KG:5000",
      ].join(","),
    );
    assert.equal(selection.status, "valid");
    assert.deepEqual(
      selection.instruments.map((row) => row.classification),
      [
        "managed_sleeve",
        "unresolved",
        "listed_instrument",
        "physical_commodity_position",
        "unresolved",
        "listed_instrument",
      ],
    );

    const unresolved = buildSimulationResearchUniversePreflight({
      selection: resolveSimulationResearchUniverseSelection(
        "managed:KRW:OTHER:10000",
      ),
      requestedEndServiceDate: "2026-07-08",
      preflight: null,
      priceRows: [],
      fxRows: [],
    });
    assert.equal(unresolved.status, "diagnostics_only");
    assert.equal(
      unresolved.instruments[0].status,
      "identity_unresolved",
    );
    assert.equal(unresolved.summary.incompleteWeightBps, 10_000);
  });

  it("keeps stored coverage but blocks execution review when provenance is absent", () => {
    const selection = resolveSimulationResearchUniverseSelection(
      "korea:KRW:069500:10000",
    );
    const model = buildSimulationResearchUniversePreflight({
      selection,
      requestedEndServiceDate: "2026-07-08",
      preflight: preflight([
        matrixInstrument("korea|KRW|069500", "ready", "KRW"),
      ]),
      priceRows: qualifiedKoreanRows().map((row) => ({
        ...row,
        adjustedCloseBasis: null,
        adjustedCloseProvider: null,
        adjustedCloseSource: null,
        adjustedCloseFetchedAt: null,
        providerSymbol: null,
        providerExchange: null,
      })),
      fxRows: [],
    });

    assert.equal(model.status, "partial_diagnostics_only");
    assert.equal(model.instruments[0].status, "provenance_incomplete");
    assert.equal(model.instruments[0].provenance.status, "incomplete");
    assert.equal(model.summary.storedEvidenceReadyWeightBps, 10_000);
    assert.equal(model.summary.provenanceReadyWeightBps, 0);
  });
});

function preflight(instruments) {
  return {
    axis: { resolvedServiceDates: SERVICE_DATES },
    matrixEvidence: { instruments },
  };
}

function matrixInstrument(instrumentKey, status, currency) {
  return {
    instrumentKey,
    status,
    priceCoverage: {
      status: "required",
      requiredServiceDateCount: 3,
      coveredServiceDateCount: status === "ready" ? 3 : 1,
      coveragePct: status === "ready" ? 100 : 33.3333,
      observedSourceDateFrom: "2026-07-03",
      observedSourceDateTo: "2026-07-07",
      reasons: status === "ready" ? [] : ["missing_price"],
    },
    fxCoverage:
      currency === "KRW"
        ? { status: "not_required" }
        : {
            status: "required",
            requiredServiceDateCount: 3,
            coveredServiceDateCount: 3,
            coveragePct: 100,
            observedSourceDateFrom: "2026-07-03",
            observedSourceDateTo: "2026-07-07",
            reasons: [],
          },
    returnCoverage: {
      requiredReturnCount: 2,
      readyReturnCount: status === "ready" ? 2 : 0,
      coveragePct: status === "ready" ? 100 : 0,
    },
    reasons: status === "ready" ? [] : ["missing_price"],
  };
}

function qualifiedKoreanRows() {
  return [
    price("2026-07-03", 100),
    price("2026-07-06", 101),
    price("2026-07-07", 102),
  ];
}

function price(priceDate, adjustedClosePrice) {
  return {
    market: "korea",
    currency: "KRW",
    ticker: "069500",
    priceDate,
    adjustedClosePrice,
    adjustedCloseBasis: ADJUSTED_CLOSE_BASIS.provider,
    adjustedCloseProvider: "fixture_provider",
    adjustedCloseSource: "fixture_provider_adjusted_history",
    adjustedCloseFetchedAt: "2026-07-10T00:00:00.000Z",
    providerSymbol: "069500",
    providerExchange: "KRX",
  };
}
