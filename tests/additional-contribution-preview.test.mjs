import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { buildAdditionalContributionPreview } from "../src/lib/additional-contribution-preview.ts";
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
    const route = readFileSync(
      "src/app/additional-contribution/page.tsx",
      "utf8",
    );
    const proxy = readFileSync("src/proxy.ts", "utf8");

    for (const source of [universeQuery, policyQuery, previewQuery]) {
      assert.match(source, /^import "server-only";/);
      assert.doesNotMatch(source, /fetch\s*\(|\/api\//);
      assert.doesNotMatch(
        source,
        /\b(?:insert|update|delete|upsert)\s*\(/i,
      );
    }
    assert.match(universeQuery, /accounts\.canonicalOwnerUserId/);
    assert.match(universeQuery, /assets\.accountId/);
    assert.match(policyQuery, /tenantContext\.ownerUserId/);
    assert.match(policyQuery, /targetPolicyApprovalRevisions\.ownerUserId/);
    assert.match(previewQuery, /Promise\.all/);
    assert.doesNotMatch(route, /^"use client";/);
    assert.doesNotMatch(route, /fetch\s*\(|\/api\//);
    assert.match(route, /searchParams: Promise/);
    assert.match(route, /method="get"/);
    assert.match(route, /resolveCurrentTenantContext/);
    assert.match(route, /if \(!resolution\.ok\)/);
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
