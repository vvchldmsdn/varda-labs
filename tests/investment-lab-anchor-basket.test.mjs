import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { resolveInvestmentLabAnchorSelection } from "../src/lib/investment-lab-anchor-basket-anchor.ts";
import { resolveInvestmentLabAnchorBasketEvidence } from "../src/lib/investment-lab-anchor-basket-evidence.ts";
import { loadInvestmentLabAnchorBasketScenario } from "../src/lib/investment-lab-anchor-basket-read-loader.ts";
import { buildInvestmentLabAnchorBasketScenario } from "../src/lib/investment-lab-anchor-basket-scenario.ts";
import {
  attachBase44ImportedTickerEvidence,
  resolveInvestmentLabSpecialHoldingIdentity,
} from "../src/lib/investment-lab-special-holding-authority.ts";

describe("investment lab anchor-date observed basket", () => {
  it("aggregates the same economic identity across accounts at the anchor", () => {
    const input = fixture();
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });

    assert.equal(anchor.status, "ready");
    assert.equal(anchor.selectedAnchorDate, "2026-01-06");
    assert.equal(anchor.candidateAnchorDates.length, 1);
    assert.equal(anchor.instruments.length, 2);
    assert.deepEqual(
      anchor.instruments.map((row) => [row.key, row.sourceRows, row.accountCount]),
      [
        ["korea:KRW:AAA", 2, 2],
        ["us:USD:BBB", 1, 1],
      ],
    );
    assert.equal(anchor.coverage.sourcePositionRows, 3);
    assert.equal(anchor.coverage.unresolvedPositionRows, 0);
  });

  it("builds an equal-at-anchor path and equal-splits later flows without rebalancing", () => {
    const input = fixture();
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });
    const evidence = resolveInvestmentLabAnchorBasketEvidence({
      anchor,
      serviceDates: input.serviceDates,
      priceRows: input.priceRows,
      snapshotRows: input.snapshotRows,
      fxRows: input.fxRows,
      boundaryFlows: input.boundaryFlows,
    });
    const scenario = buildInvestmentLabAnchorBasketScenario({
      anchor,
      actualPath: input.actualPath,
      evidence,
      actualReturn: 0.1,
    });

    assert.equal(evidence.status, "ready");
    assert.equal(scenario.status, "ready");
    assert.equal(scenario.summary.instrumentCount, 2);
    assert.equal(scenario.summary.equalWeightPct, 50);
    assert.deepEqual(
      scenario.rows.map((row) => Math.round(row.scenarioMarketValueKrw)),
      [1000, 1100, 1300],
    );
    assert.equal(scenario.coverage.sourceFlowCount, 1);
    assert.equal(scenario.coverage.scenarioFlowLegCount, 2);
    assert.equal(scenario.returnEstimate.actualReturn, 0.1);
  });

  it("blocks the whole basket for tickerless or physical stored holdings", () => {
    const input = fixture();
    input.positionRows.push({
      snapshotDate: "2026-01-06",
      account: "brokerage",
      source: "stored",
      ticker: null,
      assetName: "stored physical holding",
      market: "korea",
      currency: "KRW",
      assetType: "commodity",
      quantity: 1,
      marketValueKrw: 100,
    });
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });

    assert.equal(anchor.status, "unavailable");
    assert.deepEqual(anchor.instruments, []);
    assert.equal(anchor.coverage.sourcePositionRows, 4);
    assert.equal(anchor.coverage.recognizedPositionRows, 3);
    assert.equal(anchor.coverage.unresolvedPositionRows, 1);
    assert.deepEqual(anchor.blockers, [
      "physical_anchor_holding",
      "tickerless_anchor_holding",
    ]);
    assert.deepEqual(anchor.specialHoldingEvidence, [
      {
        name: "stored physical holding",
        account: "brokerage",
        source: "stored",
        market: "korea",
        currency: "KRW",
        assetType: "commodity",
        classification: "physical_commodity_position",
        identityStatus: "unavailable",
        resolvedTicker: null,
        resolvedProductKey: null,
        identityAuthority: "explicit_snapshot_asset_type",
        historicalAuthorityOutcome: "separate_valuation_model_required",
        historicalCoverageStatus: "blocked",
        evidenceRowCount: 0,
        reason: "instrument_keyed_official_close_required",
      },
    ]);
  });

  it("recovers a listed ticker from immutable imported snapshot consensus", () => {
    const input = fixture();
    input.positionRows.push(
      ...attachBase44ImportedTickerEvidence([
        importedIdentityRow({
          snapshotDate: "2026-01-06",
          source: "stored",
          ticker: null,
        }),
        importedIdentityRow({
          snapshotDate: "2026-01-07",
          source: "base44_import",
          ticker: "315960",
        }),
      ]),
    );
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });

    assert.equal(anchor.status, "ready");
    assert.ok(
      anchor.instruments.some((row) => row.key === "korea:KRW:315960"),
    );
    assert.equal(anchor.coverage.recognizedPositionRows, 4);
    assert.equal(anchor.coverage.unresolvedPositionRows, 0);
    assert.deepEqual(anchor.specialHoldingEvidence, [
      {
        name: "Imported listed ETF",
        account: "irp",
        source: "stored",
        market: "korea",
        currency: "KRW",
        assetType: "etf",
        classification: "stored_listed_instrument",
        identityStatus: "resolved",
        resolvedTicker: "315960",
        resolvedProductKey: null,
        identityAuthority: "base44_imported_snapshot_ticker_consensus",
        historicalAuthorityOutcome: "eligible_historical_instrument",
        historicalCoverageStatus: "not_evaluated",
        evidenceRowCount: 1,
        reason: "stored_snapshot_ticker_recovered",
      },
    ]);
  });

  it("does not recover a historical ticker when imported metadata conflicts", () => {
    const input = fixture();
    const rows = [
      importedIdentityRow({
        snapshotDate: "2026-01-06",
        source: "stored",
        ticker: null,
      }),
      importedIdentityRow({
        snapshotDate: "2026-01-07",
        source: "base44_import",
        ticker: "315960",
        assetName: "Different imported name",
      }),
    ];
    input.positionRows.push(...attachBase44ImportedTickerEvidence(rows));
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });

    assert.equal(anchor.status, "unavailable");
    assert.equal(anchor.coverage.unresolvedPositionRows, 1);
    assert.equal(
      anchor.specialHoldingEvidence[0].reason,
      "stored_snapshot_metadata_mismatch",
    );
    assert.equal(anchor.specialHoldingEvidence[0].resolvedTicker, null);
  });

  it("blocks conflicting imported tickers for one legacy identity", () => {
    const rows = attachBase44ImportedTickerEvidence([
      importedIdentityRow({ source: "stored", ticker: null }),
      importedIdentityRow({
        snapshotDate: "2026-01-07",
        source: "base44_import",
        ticker: "315960",
      }),
      importedIdentityRow({
        snapshotDate: "2026-01-08",
        source: "base44_import",
        ticker: "999999",
      }),
    ]);

    const decision = resolveInvestmentLabSpecialHoldingIdentity(rows[0]);

    assert.equal(decision.ticker, null);
    assert.equal(
      decision.specialHoldingEvidence.reason,
      "stored_snapshot_ticker_conflict",
    );
    assert.equal(
      decision.specialHoldingEvidence.historicalAuthorityOutcome,
      "separate_valuation_model_required",
    );
  });

  it("keeps explicit non-investment asset types permanently unsupported", () => {
    const decision = resolveInvestmentLabSpecialHoldingIdentity({
      ticker: null,
      assetName: "Excluded savings",
      account: "brokerage",
      source: "stored",
      market: "korea",
      currency: "KRW",
      assetType: "savings",
    });

    assert.equal(decision.ticker, null);
    assert.equal(
      decision.specialHoldingEvidence.historicalAuthorityOutcome,
      "permanently_unsupported",
    );
    assert.equal(
      decision.specialHoldingEvidence.reason,
      "non_investment_asset_type_unsupported",
    );
  });

  it("binds the reviewed KRX gold holding to the 1kg product only", () => {
    const decision = resolveInvestmentLabSpecialHoldingIdentity({
      ticker: null,
      assetName: "금현물",
      account: "brokerage",
      source: "stored",
      market: "korea",
      currency: "KRW",
      assetType: "commodity",
    });

    assert.equal(decision.ticker, null);
    assert.equal(decision.specialHoldingEvidence.identityStatus, "resolved");
    assert.equal(
      decision.specialHoldingEvidence.resolvedProductKey,
      "gold_9999_1kg",
    );
    assert.equal(
      decision.specialHoldingEvidence.identityAuthority,
      "broker_statement_and_krx_product_definition",
    );
    assert.equal(
      decision.specialHoldingEvidence.historicalAuthorityOutcome,
      "separate_valuation_model_required",
    );
  });

  it("records the exact Fount holding as excluded but keeps the path blocked", () => {
    const input = fixture();
    input.positionRows.push({
      snapshotDate: "2026-01-06",
      account: "irp",
      source: "stored",
      ticker: null,
      assetName: "Fount 일임서비스",
      market: "korea",
      currency: "KRW",
      assetType: "etf",
      quantity: 1,
      marketValueKrw: 100,
    });

    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });

    assert.equal(anchor.status, "unavailable");
    assert.equal(anchor.coverage.recognizedPositionRows, 3);
    assert.equal(anchor.coverage.excludedPositionRows, 1);
    assert.equal(anchor.coverage.separateModelPositionRows, 0);
    assert.equal(anchor.coverage.unresolvedPositionRows, 0);
    assert.deepEqual(anchor.blockers, [
      "excluded_holding_scope_transform_required",
    ]);
    assert.deepEqual(anchor.specialHoldingEvidence, [
      {
        name: "Fount 일임서비스",
        account: "irp",
        source: "stored",
        market: "korea",
        currency: "KRW",
        assetType: "etf",
        classification: "product_owner_excluded",
        identityStatus: "not_required",
        resolvedTicker: null,
        resolvedProductKey: null,
        identityAuthority: "product_owner_scope_decision",
        historicalAuthorityOutcome: "intentionally_excluded",
        historicalCoverageStatus: "not_required",
        evidenceRowCount: 0,
        reason: "product_owner_excluded_from_decision_support",
      },
    ]);

    const invalidValue = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows.map((row) =>
        row.assetName === "Fount 일임서비스"
          ? { ...row, marketValueKrw: null }
          : row,
      ),
    });
    assert.deepEqual(invalidValue.blockers, [
      "excluded_holding_scope_transform_required",
      "invalid_anchor_position_evidence",
    ]);
  });

  it("does not classify a ticker-bearing commodity ETF as physical", () => {
    const input = fixture();
    input.positionRows.push({
      ...position("brokerage", "GLD", "Listed gold ETF", "us", "USD", 100),
      assetType: "commodity",
    });
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });

    assert.equal(anchor.status, "ready");
    assert.ok(anchor.instruments.some((row) => row.key === "us:USD:GLD"));
    assert.ok(!anchor.blockers.includes("physical_anchor_holding"));
  });

  it("does not return a partial path when one component price is missing", () => {
    const input = fixture();
    const anchor = resolveInvestmentLabAnchorSelection({
      serviceDates: input.serviceDates,
      snapshotRows: input.snapshotRows,
      positionRows: input.positionRows,
    });
    const evidence = resolveInvestmentLabAnchorBasketEvidence({
      anchor,
      serviceDates: input.serviceDates,
      priceRows: input.priceRows.filter(
        (row) => !(row.ticker === "BBB" && row.priceDate === "2026-01-06"),
      ),
      snapshotRows: input.snapshotRows,
      fxRows: input.fxRows,
      boundaryFlows: input.boundaryFlows,
    });

    assert.equal(evidence.status, "unavailable");
    assert.deepEqual(evidence.components, []);
    assert.ok(
      evidence.blockers.some(
        (row) =>
          row.reason === "missing_valuation_price" &&
          row.instrumentKey === "us:USD:BBB",
      ),
    );
  });

  it("does not query broad price history when anchor evidence is incomplete", async () => {
    const input = fixture();
    input.positionRows.push({
      snapshotDate: "2026-01-06",
      account: "brokerage",
      source: "stored",
      ticker: null,
      assetName: "unresolved",
      market: "korea",
      currency: "KRW",
      assetType: null,
      quantity: 1,
      marketValueKrw: 1,
    });
    let priceReads = 0;
    const scenario = await loadInvestmentLabAnchorBasketScenario({
      repository: {
        async loadAnchorPositionRows() {
          return input.positionRows;
        },
        async loadAnchorPriceRows() {
          priceReads += 1;
          return input.priceRows;
        },
      },
      model: readModel(input.actualPath),
      source: {
        eventRows: [],
        snapshotRows: input.snapshotRows,
        closeRows: [],
        vooCloseRows: [],
        fxRows: input.fxRows,
      },
      fxRows: input.fxRows,
    });

    assert.equal(scenario.status, "unavailable");
    assert.equal(priceReads, 0);
    assert.deepEqual(scenario.blockers, [
      {
        reason: "anchor_selection_unavailable",
        instrumentKey: null,
        detail: null,
      },
    ]);
  });

  it("keeps imported snapshot consensus server-only and strips legacy identity", () => {
    const querySource = readFileSync(
      new URL("../src/db/queries/investment-lab.ts", import.meta.url),
      "utf8",
    );
    const authoritySource = readFileSync(
      new URL(
        "../src/lib/investment-lab-special-holding-authority.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const componentSource = readFileSync(
      new URL(
        "../src/components/investment-lab/investment-lab-anchor-basket.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(
      querySource,
      /attachBase44ImportedTickerEvidence/,
    );
    assert.match(authoritySource, /source !== IMPORTED_SNAPSHOT_SOURCE/);
    assert.match(authoritySource, /currentAssetFallback: "forbidden"/);
    assert.doesNotMatch(querySource, /linkedAssetTicker|linkedLegacyAssetId/);
    assert.doesNotMatch(componentSource, /^"use client";/);
    assert.doesNotMatch(componentSource, /legacyAssetId|legacyBase44Id|assetId/);
    assert.match(
      componentSource,
      /data-section="investment-lab-anchor-special-holding-evidence"/,
    );
  });

  it("does not promote a legacy close label to official gold authority", () => {
    const auditSource = readFileSync(
      new URL(
        "../scripts/audit-investment-lab-anchor-basket.mjs",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(
      auditSource,
      /lower\(coalesce\(price_source, ''\)\) =\s*'fsc_public_data_gold_daily'/,
    );
    assert.match(
      auditSource,
      /lower\(coalesce\(price_basis, ''\)\) = 'official_close'/,
    );
    assert.match(auditSource, /official_gold_close_candidate_rows/);
    assert.match(
      auditSource,
      /legacy_close_label_without_official_source_or_instrument_binding/,
    );
    assert.match(
      auditSource,
      /tickerless_noncommodity_product_authority_unresolved/,
    );
    assert.doesNotMatch(auditSource, /join\s+assets\b/i);
  });

  it("audits Fount exclusion on the exact observed-path scope", () => {
    const auditSource = readFileSync(
      new URL(
        "../scripts/audit-investment-lab-anchor-basket.mjs",
        import.meta.url,
      ),
      "utf8",
    );

    assert.match(auditSource, /FOUNT_EXCLUSION_PARITY_SQL/);
    assert.match(auditSource, /excluded_holding_scope_transform_required/);
    assert.match(auditSource, /p\.snapshot_date >= a\.snapshot_date/);
    assert.match(auditSource, /f\.source = p\.source/);
    assert.match(auditSource, /product_owner_scope_decision/);
    assert.doesNotMatch(auditSource, /join\s+assets\b/i);
    assert.doesNotMatch(auditSource, /\b(?:insert|update|delete)\b/i);
  });
});

function fixture() {
  const serviceDates = ["2026-01-06", "2026-01-07", "2026-01-08"];
  const snapshotRows = serviceDates.flatMap((snapshotDate, dateIndex) =>
    ["brokerage", "isa", "irp"].map((account) => ({
      snapshotDate,
      account,
      cashValue: 0,
      totalMarketValue: dateIndex === 0 ? 1000 / 3 : (1000 + dateIndex * 100) / 3,
      usdKrw: 1400,
      source: "stored",
      ruleVersion: "fixture_v1",
    })),
  );
  return {
    serviceDates,
    snapshotRows,
    positionRows: [
      position("brokerage", "AAA", "Alpha", "korea", "KRW", 500),
      position("irp", "AAA", "Alpha", "korea", "KRW", 100),
      position("isa", "BBB", "Beta", "us", "USD", 400),
    ],
    priceRows: [
      price("AAA", "korea", "KRW", "2026-01-05", 10),
      price("AAA", "korea", "KRW", "2026-01-06", 11),
      price("AAA", "korea", "KRW", "2026-01-07", 12),
      price("BBB", "us", "USD", "2026-01-05", 1),
      price("BBB", "us", "USD", "2026-01-06", 1.1),
      price("BBB", "us", "USD", "2026-01-07", 1.2),
    ],
    fxRows: [
      {
        rateDate: "2026-01-07",
        usdKrw: 1400,
        source: "fixture",
        status: "ok",
      },
    ],
    boundaryFlows: [
      {
        eventDate: "2026-01-07",
        sequence: 1,
        direction: "inflow",
        amountKrw: 100,
        amountProvenance: "explicit_amount_krw",
      },
    ],
    actualPath: [
      { serviceDate: "2026-01-06", totalMarketValueKrw: 1000 },
      { serviceDate: "2026-01-07", totalMarketValueKrw: 1100 },
      { serviceDate: "2026-01-08", totalMarketValueKrw: 1200 },
    ],
  };
}

function position(account, ticker, assetName, market, currency, marketValueKrw) {
  return {
    snapshotDate: "2026-01-06",
    account,
    source: "stored",
    ticker,
    assetName,
    market,
    currency,
    assetType: "etf",
    quantity: 1,
    marketValueKrw,
  };
}

function importedIdentityRow(overrides = {}) {
  return {
    identityKey: "legacy-fixture-identity",
    snapshotDate: "2026-01-06",
    account: "irp",
    source: "base44_import",
    ticker: null,
    assetName: "Imported listed ETF",
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    quantity: 1,
    marketValueKrw: 100,
    ...overrides,
  };
}

function price(ticker, market, currency, priceDate, closePrice) {
  return {
    ticker,
    market,
    currency,
    priceDate,
    closePrice,
    source: "fixture",
  };
}

function readModel(actualPath) {
  return {
    status: "ready",
    scenario: {},
    summary: null,
    returnEstimate: null,
    vooReadiness: null,
    vooComparison: null,
    cashComparison: null,
    fixedMixScenario: null,
    contributionExperimentScenarios: [],
    rows: actualPath.map((row) => ({
      serviceDate: row.serviceDate,
      actualMarketValueKrw: row.totalMarketValueKrw,
      scenarioMarketValueKrw: row.totalMarketValueKrw,
      differenceKrw: 0,
      valuationPriceDate: row.serviceDate,
      valuationCarryDays: 0,
      hasPendingExecution: false,
    })),
    coverage: {},
    blockers: [],
  };
}
