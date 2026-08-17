import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildPortfolioStructure } from "../src/lib/portfolio-structure.ts";
import { projectPortfolioStructureEffectiveTargets } from "../src/lib/portfolio-structure-target-policy.ts";

describe("portfolio structure effective target projection", () => {
  it("applies an exact approved policy without replacing raw target evidence", () => {
    const structure = fixtureStructure();
    const projection = projectPortfolioStructureEffectiveTargets({
      policyStatus: "available",
      structure,
      targets: [
        target("069500", 6_000),
        target("395160", 4_000),
      ],
    });

    assert.equal(projection.status, "applied");
    assert.equal(projection.coverage.matchedHoldingCount, 2);
    assert.equal(projection.coverage.unmatchedHoldingCount, 0);
    assert.equal(projection.coverage.unmatchedTargetCount, 0);
    assert.equal(projection.coverage.totalTargetWeightBps, 10_000);

    const kodex = projection.structure.holdingRows.find(
      (row) => row.ticker === "069500",
    );
    assert.equal(kodex.rawAssetTargetPct, 55);
    assert.equal(kodex.effectiveTargetPct, 60);
    assert.equal(kodex.driftPct, -10);
    assert.equal(kodex.targetPolicyStatus, "approved_policy");
    assert.equal(projection.structure.groupRows[0].effectiveTargetPct, 100);
    assert.equal(projection.structure.groupRows[0].driftPct, 0);
    assert.equal(projection.structure.dataHealth.unresolvedTargetPolicyCount, 0);
    assertNoInternalIds(projection);
  });

  it("keeps the raw structure unchanged when no approved policy is available", () => {
    const structure = fixtureStructure();
    const projection = projectPortfolioStructureEffectiveTargets({
      policyStatus: "missing",
      structure,
      targets: [],
    });

    assert.equal(projection.status, "unavailable");
    assert.equal(projection.reason, "missing");
    assert.equal(projection.structure, structure);
    assert.equal(projection.structure.holdingRows[0].effectiveTargetPct, null);
  });

  it("distinguishes a failed policy integrity check from a missing policy", () => {
    const structure = fixtureStructure();
    const projection = projectPortfolioStructureEffectiveTargets({
      policyStatus: "integrity_error",
      structure,
      targets: [],
    });

    assert.equal(projection.status, "invalid");
    assert.equal(projection.reason, "integrity_error");
    assert.equal(projection.structure, structure);
  });

  it("shows matched holding targets but withholds group totals for partial identity coverage", () => {
    const projection = projectPortfolioStructureEffectiveTargets({
      policyStatus: "available",
      structure: fixtureStructure(),
      targets: [
        target("069500", 6_000),
        target("MISSING", 4_000),
      ],
    });

    assert.equal(projection.status, "partial");
    assert.equal(projection.coverage.matchedHoldingCount, 1);
    assert.equal(projection.coverage.unmatchedHoldingCount, 1);
    assert.equal(projection.coverage.unmatchedTargetCount, 1);
    assert.equal(projection.structure.groupRows[0].effectiveTargetPct, null);
    assert.equal(projection.structure.groupRows[0].driftPct, null);
  });

  it("rejects ambiguous duplicate target identities", () => {
    const structure = fixtureStructure();
    const projection = projectPortfolioStructureEffectiveTargets({
      policyStatus: "available",
      structure,
      targets: [
        target("069500", 5_000),
        target("069500", 5_000),
      ],
    });

    assert.equal(projection.status, "invalid");
    assert.equal(projection.reason, "duplicate_target_identity");
    assert.equal(projection.structure, structure);
  });
});

function fixtureStructure() {
  return buildPortfolioStructure({
    assets: [
      asset({ id: "asset-a", ticker: "069500", quantity: 1, targetWeight: 55 }),
      asset({ id: "asset-b", ticker: "395160", quantity: 1, targetWeight: 45 }),
    ],
    groups: [
      {
        id: "group-a",
        name: "Core",
        targetWeight: 100,
        isActive: true,
      },
    ],
    liveQuotes: [quote("069500"), quote("395160")],
    selectedAccount: "all",
    usdKrwRate: 1_500,
  });
}

function asset(overrides) {
  return {
    id: overrides.id,
    name: overrides.ticker,
    ticker: overrides.ticker,
    account: "isa",
    market: "korea",
    currency: "KRW",
    assetType: "etf",
    quantity: overrides.quantity,
    currentPrice: 100,
    targetWeight: overrides.targetWeight,
    groupId: "group-a",
  };
}

function quote(ticker) {
  return {
    ticker,
    market: "korea",
    currency: "KRW",
    price: 100,
    source: "fixture",
    status: "ok",
  };
}

function target(ticker, targetWeightBps) {
  return {
    account: "isa",
    market: "korea",
    currency: "KRW",
    ticker,
    targetWeightBps,
  };
}

function assertNoInternalIds(value) {
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes("asset-a"), false);
  assert.equal(serialized.includes("asset-b"), false);
  assert.equal(serialized.includes("group-a"), false);
  assert.equal(serialized.includes("assetId"), false);
  assert.equal(serialized.includes("groupId"), false);
}
