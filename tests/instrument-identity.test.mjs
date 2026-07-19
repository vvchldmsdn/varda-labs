import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  KRX_GOLD_ACTIVE_VALUATION_POLICY,
  KRX_GOLD_CLOSE_ONLY_CONTRACT,
  buildInstrumentSemanticKey,
  classifyKrxGoldCloseMovement,
  resolveKrxGoldCloseEvidence,
} from "../src/lib/instrument-identity.ts";

describe("KRX gold close-only instrument contract", () => {
  it("uses a stored manual price until the next explicit update", () => {
    assert.deepEqual(KRX_GOLD_ACTIVE_VALUATION_POLICY, {
      version: "krx_gold_manual_valuation_v1",
      approvedOn: "2026-07-19",
      productKey: "gold_9999_1kg",
      holdingUnit: "g",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_G",
      currentValuation: {
        mode: "stored_manual_price",
        source: "manual_entry",
        quoteKind: "manual_valuation",
        storage: "assets.current_price",
        carryPolicy: "retain_until_next_manual_update",
      },
      history: {
        admission: "manual_observations_only",
        currentValueBackcast: "forbidden",
        missingObservationFill: "forbidden_without_separate_policy",
      },
      automatedProvider: "deferred_not_current_gate",
    });
  });

  it("binds the reviewed broker holding without claiming source readiness", () => {
    assert.deepEqual(KRX_GOLD_CLOSE_ONLY_CONTRACT.verifiedMarketFacts, {
      instrumentKind: "commodity_spot",
      venue: "KRX_GOLD",
      purity: "99.99%",
      holdingUnit: "g",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_G",
      transactionUnitG: 1,
      productCandidates: [
        { productKey: "gold_9999_1kg", withdrawalUnitG: 1_000 },
        { productKey: "gold_9999_100g", withdrawalUnitG: 100 },
      ],
    });
    assert.deepEqual(KRX_GOLD_CLOSE_ONLY_CONTRACT.identityBinding, {
      status: "resolved",
      productKey: "gold_9999_1kg",
      holdingUnit: "g",
      authority: "broker_holding_statement_and_krx_product_definition",
      evidenceReviewedOn: "2026-07-16",
      sensitiveEvidenceStored: false,
    });
    assert.deepEqual(KRX_GOLD_CLOSE_ONLY_CONTRACT.pricing, {
      mode: "official_close_only",
      source: "fsc_public_data_gold_daily",
      quoteKind: "official_close",
      liveQuoteEligible: false,
    });
    assert.doesNotMatch(
      JSON.stringify(KRX_GOLD_CLOSE_ONLY_CONTRACT),
      /kiwoom|kis|live_price/i,
    );
  });

  it("keeps both KRX gold products distinct from each other and from proxies", () => {
    const sharedGoldIdentity = {
      instrumentKind: "commodity_spot",
      venue: "KRX_GOLD",
      holdingUnit: "g",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_G",
    };
    const gold1kg = buildInstrumentSemanticKey({
      ...sharedGoldIdentity,
      productKey: "gold_9999_1kg",
    });
    const gold100g = buildInstrumentSemanticKey({
      ...sharedGoldIdentity,
      productKey: "gold_9999_100g",
    });
    const aceGoldEtf = buildInstrumentSemanticKey({
      instrumentKind: "etf",
      venue: "KRX_SECURITIES",
      productKey: "411060",
      holdingUnit: "share",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_SHARE",
    });
    const goldFuture = buildInstrumentSemanticKey({
      instrumentKind: "commodity_future",
      venue: "KRX_DERIVATIVES",
      productKey: "gold_future",
      holdingUnit: "contract",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_CONTRACT",
    });
    const convertedReference = buildInstrumentSemanticKey({
      instrumentKind: "reference_price",
      venue: "INTERNATIONAL_GOLD_CONVERSION",
      productKey: "converted_gold_reference",
      holdingUnit: "g",
      quoteCurrency: "KRW",
      quoteUnit: "KRW_PER_G",
    });

    assert.ok(gold1kg);
    assert.ok(gold100g);
    assert.equal(
      new Set([
        gold1kg,
        gold100g,
        aceGoldEtf,
        goldFuture,
        convertedReference,
      ]).size,
      5,
    );
    assert.equal(
      buildInstrumentSemanticKey({
        ...sharedGoldIdentity,
        productKey: " ",
      }),
      null,
    );
  });

  it("does not claim runtime source or anchor-model readiness", () => {
    assert.deepEqual(KRX_GOLD_CLOSE_ONLY_CONTRACT.sourceFeasibility, {
      status: "read_only_dry_run_ready",
      availableFrom: "actual_response_coverage_pending",
      access: "free_auto_approval_service_key_required",
      providerInstrumentBinding: "04020000_KRD040200002_gold_99_99_1kg",
      providerCloseFieldBinding: "basDt_clpr",
      multiUserDisplayRights: "unrestricted_public_data_portal_license",
      attributionRequired: false,
      actualResponseCoverage: "not_verified",
    });
    assert.deepEqual(KRX_GOLD_CLOSE_ONLY_CONTRACT.datePolicy, {
      observationDate: "krx_trading_date",
      snapshotReferenceDate: "same_krx_trading_date",
      serviceCycleMapping: "krx_gold_close_cycle_v1",
      nonTradingDate:
        "carry_latest_prior_observation_without_synthetic_copy",
    });
    assert.deepEqual(KRX_GOLD_CLOSE_ONLY_CONTRACT.anchorModel, {
      currentFractionalModel: "requires_explicit_research_assumption",
      executionFaithfulModel:
        "integer_grams_with_residual_cash_not_implemented",
      shortSelling: "forbidden_fail_closed",
    });
  });

  it("selects a newer close and retains the last success on failure", () => {
    const current = closeEvidence("2026-07-08", 151_000, "2026-07-08T08:00:00Z");
    const newer = closeEvidence("2026-07-09", 152_000, "2026-07-09T08:00:00Z");

    const selected = resolveKrxGoldCloseEvidence({ current, candidate: newer });
    assert.equal(selected.selection, "candidate");
    assert.equal(selected.reason, "newer_close");
    assert.equal(selected.selected?.priceDate, "2026-07-09");

    const retained = resolveKrxGoldCloseEvidence({
      current: newer,
      candidate: { status: "unavailable", reason: "provider_failure" },
    });
    assert.equal(retained.selection, "current");
    assert.equal(retained.reason, "candidate_unavailable");
    assert.equal(retained.selected?.price, 152_000);
  });

  it("accepts only a later same-date correction and ignores old closes", () => {
    const current = closeEvidence("2026-07-09", 152_000, "2026-07-09T08:00:00Z");
    const corrected = closeEvidence("2026-07-09", 152_100, "2026-07-09T09:00:00Z");
    const correction = resolveKrxGoldCloseEvidence({
      current,
      candidate: corrected,
    });
    assert.equal(correction.selection, "candidate");
    assert.equal(correction.reason, "same_date_correction");

    const earlierFetch = resolveKrxGoldCloseEvidence({
      current: corrected,
      candidate: current,
    });
    assert.equal(earlierFetch.selection, "current");
    assert.equal(earlierFetch.reason, "earlier_correction_ignored");

    const older = resolveKrxGoldCloseEvidence({
      current,
      candidate: closeEvidence(
        "2026-07-08",
        151_000,
        "2026-07-10T08:00:00Z",
      ),
    });
    assert.equal(older.selection, "current");
    assert.equal(older.reason, "older_close_ignored");
  });

  it("does not convert an unchanged close date into zero today movement", () => {
    const baseline = closeEvidence(
      "2026-07-08",
      150_000,
      "2026-07-08T08:00:00Z",
    );
    const sameDate = closeEvidence(
      "2026-07-08",
      150_000,
      "2026-07-09T00:00:00Z",
    );
    const result = classifyKrxGoldCloseMovement({
      quantityG: 8,
      baseline,
      latest: sameDate,
    });

    assert.equal(result.status, "awaiting_new_close");
    assert.equal(result.includeInTodayAggregate, false);
    assert.equal(result.movementKrw, null);
    assert.equal(result.returnPct, null);
  });

  it("calculates close-to-close movement only when a newer close exists", () => {
    const result = classifyKrxGoldCloseMovement({
      quantityG: 8,
      baseline: closeEvidence(
        "2026-07-08",
        150_000,
        "2026-07-08T08:00:00Z",
      ),
      latest: closeEvidence(
        "2026-07-09",
        153_000,
        "2026-07-09T08:00:00Z",
      ),
    });

    assert.equal(result.status, "comparable");
    assert.equal(result.includeInTodayAggregate, true);
    assert.equal(result.unitPriceChangeKrwPerG, 3_000);
    assert.equal(result.movementKrw, 24_000);
    assert.ok(Math.abs(result.returnPct - 2) < 1e-10);
  });

  it("keeps Phase 0 pure and records the current ticker dependencies", () => {
    const source = readFileSync("src/lib/instrument-identity.ts", "utf8");
    const schema = readFileSync("src/db/schema.ts", "utf8");
    const priceSync = readFileSync("src/lib/market-data/price-sync.ts", "utf8");
    const dailySnapshot = readFileSync("src/lib/snapshots/daily.ts", "utf8");
    const gateBUniverse = readFileSync(
      "src/lib/target-policy-holding-universe.ts",
      "utf8",
    );
    const riskInput = readFileSync(
      "src/lib/portfolio-risk-input-sources.ts",
      "utf8",
    );
    const labReadiness = readFileSync(
      "src/lib/investment-lab-counterfactual-readiness.ts",
      "utf8",
    );

    assert.doesNotMatch(
      source,
      /server-only|@\/db|drizzle|fetch\s*\(|livePriceQuotes|assetPriceSnapshots/i,
    );
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+\w+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate\s+table)\b/i,
    );
    assert.match(
      schema,
      /assetPriceSnapshots[\s\S]*?ticker: varchar\("ticker"[^\n]*\.notNull\(\)/,
    );
    assert.match(
      schema,
      /livePriceQuotes[\s\S]*?ticker: varchar\("ticker"[^\n]*\.notNull\(\)/,
    );
    assert.match(priceSync, /if \(!ticker\) continue/);
    assert.match(dailySnapshot, /tickerless_current_price_fallback/);
    assert.match(gateBUniverse, /if \(!row\.ticker\) return "tickerless"/);
    assert.match(riskInput, /if \(!ticker\) return "missing_ticker"/);
    assert.match(labReadiness, /ticker_only_instrument_identity/);
  });
});

function closeEvidence(priceDate, price, fetchedAt) {
  return {
    status: "ok",
    source: "fsc_public_data_gold_daily",
    quoteKind: "official_close",
    price,
    priceDate,
    fetchedAt,
  };
}
