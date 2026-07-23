import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildProviderHistoryShortlist } from "../src/lib/market-data/provider-history-shortlist.ts";

describe("Provider history shortlist", () => {
  it("lists candidates whose policy-ordered first required action appears earliest", () => {
    const result = buildProviderHistoryShortlist({
      ...request(),
      candidates: [
        candidate({
          providerId: "eodhd",
          entitlements: entitlements("contract_required"),
        }),
        candidate({
          providerId: "other",
          instrumentBindings: [
            binding("korea", "KRW", "069500", "unproven"),
            binding("us", "USD", "QQQ", "documented"),
          ],
        }),
      ],
    });

    assert.deepEqual(result.summary.firstRequiredActionProviderIds, [
      "eodhd",
    ]);
    assert.equal(result.summary.providerAdoptionAdmitted, false);
    assert.equal(
      result.policy.consumerScope,
      "historical_research_scenarios_only",
    );
    assert.deepEqual(result.policy.prohibitedConsumers, [
      "current_valuation",
      "official_close",
      "observed_portfolio_path",
    ]);
    assert.equal(
      result.candidates[0].nextAction,
      "request_written_commercial_terms",
    );
    assert.equal(result.candidates[0].commercialStatus, "contract_required");
    assert.equal(
      result.candidates[0].officialSources[0].url,
      "https://example.com/provider",
    );
    assert.equal(
      result.candidates[0].historyEvidence.endpointId,
      "fixture.eod",
    );
    assert.equal(result.candidates[0].providerCallAdmitted, false);
    assert.equal(result.candidates[0].sharedCacheWriteAdmitted, false);
  });

  it("does not promote runtime-observed bindings to documented history bindings", () => {
    const result = buildProviderHistoryShortlist({
      ...request(),
      candidates: [
        candidate({
          instrumentBindings: [
            binding("korea", "KRW", "069500", "runtime_observed"),
            binding("us", "USD", "QQQ", "runtime_observed"),
          ],
        }),
      ],
    }).candidates[0];

    assert.equal(result.instrumentCoverage.runtimeObservedCount, 2);
    assert.equal(
      result.nextAction,
      "confirm_exact_instrument_binding",
    );
  });

  it("keeps split-only prices ineligible for total-return modeling", () => {
    const result = buildProviderHistoryShortlist({
      ...request(),
      candidates: [
        candidate({
          history: history({
            priceModel: claim("split_adjusted_only_documented"),
          }),
        }),
      ],
    }).candidates[0];

    assert.equal(
      result.nextAction,
      "confirm_total_return_price_model",
    );
  });

  it("requires a separate bounded payload parity trial after contracts are admitted", () => {
    const result = buildProviderHistoryShortlist({
      ...request(),
      candidates: [candidate()],
    }).candidates[0];

    assert.equal(
      result.nextAction,
      "run_separately_authorized_bounded_payload_parity_trial",
    );
    assert.equal(result.providerCallAdmitted, false);
    assert.equal(result.sharedCacheWriteAdmitted, false);
  });

  it("blocks unknown evidence source references", () => {
    const result = buildProviderHistoryShortlist({
      ...request(),
      candidates: [
        candidate({
          history: history({
            rangeCapability: claim("documented", ["missing-source"]),
          }),
        }),
      ],
    }).candidates[0];

    assert.equal(result.validEvidence, false);
    assert.equal(result.nextAction, "blocked_invalid_evidence");
    assert.ok(
      result.blockers.includes("invalid_evidence_source_reference"),
    );
  });

  it("blocks duplicate provider identities instead of choosing one", () => {
    const result = buildProviderHistoryShortlist({
      ...request(),
      candidates: [candidate(), candidate()],
    });

    assert.deepEqual(result.summary.duplicateProviderIds, [
      "fixture_provider",
    ]);
    assert.deepEqual(result.summary.firstRequiredActionProviderIds, []);
    assert.ok(
      result.candidates.every(
        (row) => row.nextAction === "blocked_invalid_evidence",
      ),
    );
  });

  it("blocks unknown status values instead of treating them as unproven", () => {
    const result = buildProviderHistoryShortlist({
      ...request(),
      candidates: [
        candidate({
          entitlements: {
            ...entitlements("admitted"),
            display: claim("unknown_status"),
          },
        }),
      ],
    }).candidates[0];

    assert.equal(result.validEvidence, false);
    assert.equal(result.nextAction, "blocked_invalid_evidence");
    assert.ok(result.blockers.includes("invalid_entitlement_status"));
  });
});

function request() {
  return {
    requestedSourceDateRange: {
      from: "2025-12-08",
      to: "2026-07-08",
    },
    requiredInstruments: [
      { market: "korea", currency: "KRW", ticker: "069500" },
      { market: "us", currency: "USD", ticker: "QQQ" },
    ],
  };
}

function candidate(overrides = {}) {
  return {
    providerId: "fixture_provider",
    officialSources: [
      {
        id: "fixture",
        title: "Fixture official source",
        url: "https://example.com/provider",
        reviewedAt: "2026-07-23",
      },
    ],
    entitlements: entitlements("admitted"),
    instrumentBindings: [
      binding("korea", "KRW", "069500", "documented"),
      binding("us", "USD", "QQQ", "documented"),
    ],
    history: history(),
    ...overrides,
  };
}

function entitlements(status) {
  return {
    fetch: claim(status),
    store: claim(status),
    display: claim(status),
    multiUser: claim(status),
  };
}

function binding(market, currency, ticker, status) {
  return {
    instrument: { market, currency, ticker },
    providerSymbol: `${ticker}.FIXTURE`,
    providerExchange: market === "korea" ? "XKRX" : "XNAS",
    evidence: claim(status),
  };
}

function history(overrides = {}) {
  return {
    endpointId: "fixture.eod",
    rangeCapability: claim("documented"),
    pagination: claim("documented"),
    priceModel: claim("distribution_adjusted_documented"),
    requestedWindowCoverage: "unproven",
    corporateActionParity: "unproven",
    correctionPolicy: claim("documented"),
    duplicatePolicy: claim("documented"),
    ...overrides,
  };
}

function claim(status, sourceIds) {
  return {
    status,
    sourceIds:
      sourceIds ??
      (["documented", "admitted", "contract_required"].includes(status)
        ? ["fixture"]
        : []),
  };
}
