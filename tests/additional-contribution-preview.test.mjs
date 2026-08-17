import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  additionalContributionMa120ReadFailure,
  attachAdditionalContributionMa120Evidence,
  buildAdditionalContributionPreview,
} from "../src/lib/additional-contribution-preview.ts";
import { buildTargetPolicyHoldingUniverse } from "../src/lib/target-policy-holding-universe.ts";
import { buildTargetPolicyReviewPacket } from "../src/lib/target-policy-review-packet.ts";

describe("additional contribution tenant preview", () => {
  it("combines an approved vector with current valuation evidence", () => {
    const input = validInput();
    const result = buildAdditionalContributionPreview(input);

    assert.equal(result.status, "ready");
    assert.equal(result.account, "isa");
    assert.equal(result.policyVersion, "fixture-v1");
    assert.equal(result.totalAllocatedKrw, 3_000);
    assert.equal(result.residualCashKrw, 0);
    assert.equal(
      result.rows.reduce((sum, row) => sum + row.allocationKrw, 0),
      3_000,
    );
    assert.deepEqual(
      result.rows.map((row) => [row.ticker, row.allocationKrw]),
      [
        ["AAA", 1_775],
        ["BBB", 1_225],
        ["CCC", 0],
      ],
    );
    assert.ok(
      result.rows.every((row) =>
        Number.isFinite(row.postTopupWeightPct),
      ),
    );
  });

  it("fails closed when approval authority is absent", () => {
    const input = validInput();
    const result = buildAdditionalContributionPreview({
      ...input,
      approvedPolicyRead: { status: "missing", policy: null },
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["target_policy_missing"]);
    assert.equal(result.rows.length, 0);
  });

  it("fails closed when a target instrument lacks current valuation", () => {
    const input = validInput();
    const result = buildAdditionalContributionPreview({
      ...input,
      structure: {
        ...input.structure,
        holdingRows: input.structure.holdingRows.slice(0, 2),
      },
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["valuation_identity_missing"]);
  });

  it("does not expose tenant identifiers or approval evidence references", () => {
    const result = buildAdditionalContributionPreview(validInput());
    const serialized = JSON.stringify(result);

    assert.doesNotMatch(
      serialized,
      /owner|legacy|approvalEvidence|authorization|api[_-]?key|secret|token/i,
    );
    assert.doesNotMatch(
      serialized,
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
  });

  it("attaches MA120 evidence without changing the baseline allocation", () => {
    const baseline = buildAdditionalContributionPreview(validInput());
    assert.equal(baseline.status, "ready");
    const before = baseline.rows.map((row) => [row.ticker, row.allocationKrw]);
    const attached = attachAdditionalContributionMa120Evidence({
      preview: baseline,
      ma120Read: {
        policyVersion: "ma120-fixture-v1",
        allocationEffect: "none",
        status: "partial",
        suppliedHoldingCount: 3,
        evaluatedHoldingCount: 3,
        usableCount: 1,
        unavailableCount: 2,
        rows: [ma120ReadRow("AAA")],
      },
    });

    assert.equal(attached.status, "ready");
    assert.equal(attached.ma120Evidence.allocationEffect, "none");
    assert.deepEqual(
      attached.rows.map((row) => [row.ticker, row.allocationKrw]),
      before,
    );
    assert.equal(attached.totalAllocatedKrw, baseline.totalAllocatedKrw);
    assert.equal(attached.residualCashKrw, baseline.residualCashKrw);
    assert.equal(attached.rows[0].ma120Evidence.status, "above_ma");
    assert.equal(attached.rows[1].ma120Evidence.status, "unavailable");
  });

  it("keeps a ready allocation visible when the MA120 read fails", () => {
    const baseline = buildAdditionalContributionPreview(validInput());
    assert.equal(baseline.status, "ready");
    const attached = attachAdditionalContributionMa120Evidence({
      preview: baseline,
      ma120Read: additionalContributionMa120ReadFailure(3),
    });

    assert.equal(attached.status, "ready");
    assert.equal(attached.ma120Evidence.status, "read_failed");
    assert.equal(attached.rows.length, 3);
    assert.ok(
      attached.rows.every(
        (row) => row.ma120Evidence.status === "unavailable",
      ),
    );
  });

  it("keeps reads tenant-scoped, parallel, and server-only", () => {
    const universeQuery = readFileSync(
      "src/db/queries/target-policy-holding-universe.ts",
      "utf8",
    );
    const policyQuery = readFileSync(
      "src/db/queries/target-policy.ts",
      "utf8",
    );
    const previewQuery = readFileSync(
      "src/db/queries/additional-contribution.ts",
      "utf8",
    );
    const ma120Query = readFileSync(
      "src/db/queries/additional-contribution-ma120.ts",
      "utf8",
    );
    const route = readFileSync(
      "src/app/additional-contribution/page.tsx",
      "utf8",
    );
    const proxy = readFileSync("src/proxy.ts", "utf8");

    for (const source of [
      universeQuery,
      policyQuery,
      previewQuery,
      ma120Query,
    ]) {
      assert.match(source, /^import "server-only";/);
      assert.doesNotMatch(source, /fetch\s*\(|\/api\//);
      assert.doesNotMatch(
        source,
        /\b(?:insert|update|delete|upsert)\s*\(/i,
      );
    }
    assert.match(universeQuery, /accounts\.canonicalOwnerUserId/);
    assert.match(universeQuery, /assets\.accountId/);
    assert.match(policyQuery, /loadCurrentTenantLegacyTargetPolicy/);
    assert.doesNotMatch(policyQuery, /from "@\/db\/client"/);
    assert.match(previewQuery, /Promise\.all/);
    assert.match(ma120Query, /Promise\.all/);
    assert.match(ma120Query, /getActivePortfolioOwnerUserIds/);
    assert.match(
      ma120Query,
      /admitPrivateSingleTenantRawTrendEvidenceRows/,
    );
    assert.match(ma120Query, /allocationEffect: "none"/);
    assert.doesNotMatch(ma120Query, /assets\.ma_?120|daysAboveMa/i);
    assert.doesNotMatch(route, /^"use client";/);
    assert.doesNotMatch(route, /fetch\s*\(|\/api\//);
    assert.match(route, /searchParams: Promise/);
    assert.match(route, /method="get"/);
    assert.match(route, /resolveCurrentTenantContext/);
    assert.match(route, /if \(!resolution\.ok\)/);
    assert.match(route, /getReadOnlyTenantPortfolioAnalysisScopeContext/);
    assert.match(route, /PortfolioAnalysisScopeTabs/);
    assert.match(
      route,
      /getReadOnlyTenantAdditionalContributionPreviewForScope/,
    );
    assert.doesNotMatch(route, /resolveAdditionalContributionScope/);
    assert.match(route, /name="scope"/);
    assert.doesNotMatch(
      proxy,
      /"\/additional-contribution(?:\/:path\*)?"/,
    );
  });
});

function validInput() {
  const holdings = [
    holding("AAA", "Alpha"),
    holding("BBB", "Beta"),
    holding("CCC", "Gamma"),
  ];
  const universe = buildTargetPolicyHoldingUniverse({
    account: "isa",
    holdings,
  });
  const packet = buildTargetPolicyReviewPacket({
    account: "isa",
    policyVersion: "fixture-v1",
    effectiveServiceDate: "2026-07-01",
    currentHoldings: universe.rows,
    decisions: [
      decision("AAA", 4_000),
      decision("BBB", 3_000),
      decision("CCC", 3_000),
    ],
  });
  assert.equal(universe.status, "reviewable");
  assert.equal(packet.status, "reviewable");

  return {
    account: "isa",
    cashAmountKrw: 3_000,
    serviceDate: "2026-07-12",
    approvedPolicyRead: {
      status: "available",
      policy: {
        approvalState: "approved",
        policyId: packet.policy.policyId,
        account: "isa",
        policyVersion: "fixture-v1",
        effectiveServiceDate: "2026-07-01",
        universeHash: universe.universeHash,
        vectorHash: packet.vectorHash,
        vector: packet.canonicalVector,
      },
    },
    currentUniverse: universe,
    structure: structureFixture(),
  };
}

function ma120ReadRow(ticker) {
  return {
    instrumentKey: `korea:KRW:${ticker}`,
    status: "above_ma",
    priceBasis: "private_kis_raw_close",
    evidence: {
      status: "above_ma",
      policy: {
        version: "fixture",
        mode: "evidence_only",
        windowObservationCount: 120,
        allowedPriceBases: [
          "provider_adjusted_close",
          "private_kis_raw_close",
        ],
        historyBoundary: "price_date_lte_as_of_price_date",
        observationBasis:
          "distinct_observed_price_dates_without_calendar_carry",
        allocationEffect: "none",
        recommendation: "forbidden",
      },
      instrumentKey: `korea:KRW:${ticker}`,
      asOfPriceDate: "2026-07-12",
      comparisonPrice: 120,
      priceBasis: "private_kis_raw_close",
      availableObservationCount: 120,
      usedObservationCount: 120,
      ignoredFutureObservationCount: 0,
      oldestWindowPriceDate: "2026-01-01",
      latestWindowPriceDate: "2026-07-11",
      ma120: 100,
      distanceFromMaPct: 20,
      blockers: [],
    },
    unavailableReason: null,
  };
}

function holding(ticker, name) {
  return {
    name,
    market: "korea",
    currency: "KRW",
    ticker,
  };
}

function decision(ticker, targetWeightBps) {
  return {
    market: "korea",
    currency: "KRW",
    ticker,
    decision: targetWeightBps === 0 ? "zero_target" : "positive_target",
    targetWeightBps,
    exclusionReason: null,
  };
}

function structureFixture() {
  return {
    selectedAccount: "isa",
    usdKrwRate: 1_500,
    totalValueKrw: 10_000,
    includedHoldingCount: 3,
    excludedHoldingCount: 0,
    holdingRows: [
      valuation("AAA", "Alpha", 1_000),
      valuation("BBB", "Beta", 1_000),
      valuation("CCC", "Gamma", 8_000),
    ],
    groupRows: [],
    exclusions: [],
    dataHealth: {
      inputAssetCount: 3,
      selectedAssetCount: 3,
      includedHoldingCount: 3,
      excludedHoldingCount: 0,
      missingPriceCount: 0,
      missingFxCount: 0,
      unsupportedCurrencyCount: 0,
      unresolvedTargetPolicyCount: 3,
    },
  };
}

function valuation(ticker, name, currentValueKrw) {
  return {
    name,
    ticker,
    account: "isa",
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    groupName: "Ungrouped",
    quantity: 1,
    currentPrice: currentValueKrw,
    currentValueKrw,
    currentWeightPct: 0,
    rawAssetTargetPct: null,
    groupTargetPct: null,
    memberAllocationRatioPct: null,
    effectiveTargetPct: null,
    driftPct: null,
    targetPolicyStatus: "target_policy_unresolved",
    priceEvidenceSource: "asset_current_price_fallback",
    priceSource: "fixture",
    priceFetchedAt: null,
    priceAsOf: null,
  };
}
