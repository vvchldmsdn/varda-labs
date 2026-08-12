import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  buildInvestmentLabApprovedTargetWeightScenario,
  composeInvestmentLabApprovedTargetWeightScenario,
} from "../src/lib/investment-lab-approved-target-weight.ts";
import { buildTargetPolicyHoldingUniverse } from "../src/lib/target-policy-holding-universe.ts";
import {
  buildTargetPolicyReviewPacket,
  TARGET_POLICY_REVIEW_PACKET_POLICY,
} from "../src/lib/target-policy-review-packet.ts";

describe("investment lab approved target-weight path", () => {
  it("uses the exact approved vector after its effective date", () => {
    const input = fixture();
    const scenario = buildInvestmentLabApprovedTargetWeightScenario(input);

    assert.equal(scenario.status, "ready");
    assert.equal(scenario.account, "isa");
    assert.equal(scenario.policyBindings.length, 1);
    assert.equal(scenario.policyBindings[0].policyVersion, "isa-v1");
    assert.deepEqual(
      scenario.weights.map((row) => [row.instrumentKey, row.targetWeightBps]),
      [
        ["korea:KRW:133690", 3500],
        ["korea:KRW:360200", 6500],
      ],
    );
    assert.equal(
      scenario.summary.allocationBasis,
      "single_scope_approved_target_weight_monthly",
    );
    assert.equal(scenario.summary.rebalanceCount, 1);
    assert.deepEqual(
      scenario.rows.map((row) => row.rebalanced),
      [false, true, false],
    );
  });

  it("does not backcast an approved policy before its effective date", () => {
    const input = fixture({
      dates: ["2026-07-10", "2026-08-03", "2026-08-04"],
    });
    const scenario = buildInvestmentLabApprovedTargetWeightScenario(input);

    assert.equal(scenario.status, "unavailable");
    assert.ok(scenario.blockers.includes("target_policy_not_effective"));
  });

  it("isolates a missing policy to this scenario", () => {
    const input = fixture();
    const scenario = buildInvestmentLabApprovedTargetWeightScenario({
      ...input,
      targetPolicyContext: null,
    });

    assert.equal(scenario.status, "unavailable");
    assert.deepEqual(scenario.blockers, ["approved_target_policy_missing"]);
  });

  it("requires every named account policy before composing the all-account path", () => {
    const ready = buildInvestmentLabApprovedTargetWeightScenario(fixture());
    const missing = buildInvestmentLabApprovedTargetWeightScenario({
      ...fixture(),
      account: "brokerage",
      targetPolicyContext: null,
    });
    const composed = composeInvestmentLabApprovedTargetWeightScenario({
      pooledModel: {},
      pooledAnchor: fixture().anchor,
      named: {
        brokerage: missing,
        isa: ready,
        irp: { ...missing, account: "irp" },
      },
    });

    assert.equal(composed.status, "unavailable");
    assert.ok(
      composed.blockers.includes("named_account_target_policy_unavailable"),
    );
    assert.ok(composed.blockers.includes("target_policy_unavailable:brokerage"));
    assert.ok(composed.blockers.includes("target_policy_unavailable:irp"));
  });

  it("composes complete named-account target paths for the all scope", () => {
    const base = buildInvestmentLabApprovedTargetWeightScenario(fixture());
    assert.equal(base.status, "ready");
    const named = Object.fromEntries(
      ["brokerage", "isa", "irp"].map((account) => [
        account,
        {
          ...base,
          account,
          policyBindings: base.policyBindings.map((row) => ({
            ...row,
            account,
          })),
          weights: base.weights.map((row) => ({ ...row, account })),
        },
      ]),
    );
    const composed = composeInvestmentLabApprovedTargetWeightScenario({
      pooledModel: {
        observedPath: {
          status: "ready",
          rows: base.rows.map((row) => ({
            serviceDate: row.serviceDate,
            marketValueKrw: row.actualMarketValueKrw * 3,
          })),
        },
      },
      pooledAnchor: fixture().anchor,
      named,
    });

    assert.equal(composed.status, "ready");
    assert.equal(composed.account, "all");
    assert.equal(composed.policyBindings.length, 3);
    assert.equal(composed.weights.length, base.weights.length * 3);
    assert.equal(
      composed.summary.allocationBasis,
      "named_account_approved_target_weight_monthly_then_sum",
    );
    assert.deepEqual(
      composed.rows.map((row) => row.actualMarketValueKrw),
      base.rows.map((row) => row.actualMarketValueKrw * 3),
    );
  });

  it("keeps the policy pure and non-executable", () => {
    const source = readFileSync(
      "src/lib/investment-lab-approved-target-weight.ts",
      "utf8",
    );

    assert.doesNotMatch(source, /server-only|@\/db|process\.env|\bfetch\s*\(/);
    assert.doesNotMatch(
      source,
      /\b(?:insert\s+into|update\s+[a-z_\"]+\s+set|delete\s+from|alter\s+table|create\s+table|drop\s+table|truncate)\b/i,
    );
    assert.match(source, /recommendationAuthority:\s*"none"/);
    assert.match(source, /orderAuthority:\s*"none"/);
    assert.doesNotMatch(source, /orderAuthority:\s*"(?:write|execute)"/i);
  });
});

function fixture({
  dates = ["2026-07-13", "2026-08-03", "2026-08-04"],
} = {}) {
  const holdings = [
    {
      name: "TIGER 미국나스닥100",
      market: "korea",
      currency: "KRW",
      ticker: "133690",
    },
    {
      name: "ACE 미국S&P500",
      market: "korea",
      currency: "KRW",
      ticker: "360200",
    },
  ];
  const decisions = [
    {
      market: "korea",
      currency: "KRW",
      ticker: "133690",
      decision: "positive_target",
      targetWeightBps: 3500,
      exclusionReason: null,
    },
    {
      market: "korea",
      currency: "KRW",
      ticker: "360200",
      decision: "positive_target",
      targetWeightBps: 6500,
      exclusionReason: null,
    },
  ];
  const universe = buildTargetPolicyHoldingUniverse({
    account: "isa",
    holdings,
  });
  const packet = buildTargetPolicyReviewPacket({
    account: "isa",
    policyVersion: "isa-v1",
    effectiveServiceDate: "2026-07-11",
    currentHoldings: holdings.map((row) => ({
      ...row,
      buyability: "buyable",
    })),
    decisions,
  });
  assert.equal(universe.status, "reviewable");
  assert.equal(packet.status, "reviewable");

  const instruments = [
    instrument("133690", "TIGER 미국나스닥100", 600),
    instrument("360200", "ACE 미국S&P500", 400),
  ];
  const anchor = {
    status: "ready",
    policy: {},
    selectedAnchorDate: dates[0],
    candidateAnchorDates: [dates[0]],
    instruments,
    coverage: {},
    specialHoldingEvidence: [],
    blockers: [],
  };
  return {
    account: "isa",
    anchor,
    actualPath: dates.map((serviceDate) => ({
      serviceDate,
      totalMarketValueKrw: 1_000,
    })),
    evidence: {
      status: "ready",
      policy: {},
      components: [
        component(instruments[0], dates, [10, 20, 20]),
        component(instruments[1], dates, [20, 20, 30]),
      ],
      coverage: {
        serviceDateCount: dates.length,
        instrumentCount: instruments.length,
        sourcePriceRows: 6,
        relevantFlowCount: 0,
        valuationEvidenceRows: 6,
        executionEvidenceRows: 0,
        manualSourceRows: 0,
        manualObservationRows: 0,
        manualCarryRows: 0,
      },
      blockers: [],
    },
    actualReturn: 0,
    targetPolicyContext: {
      approvedPolicyRead: {
        status: "available",
        policy: {
          approvalState: "approved",
          policyId: TARGET_POLICY_REVIEW_PACKET_POLICY.policyId,
          account: "isa",
          policyVersion: "isa-v1",
          effectiveServiceDate: "2026-07-11",
          universeHash: universe.universeHash,
          vectorHash: packet.vectorHash,
          vector: packet.canonicalVector,
        },
      },
      currentUniverse: {
        account: "isa",
        rows: holdings,
      },
    },
  };
}

function instrument(ticker, label, storedMarketValueKrw) {
  return {
    key: `korea:KRW:${ticker}`,
    valuationModel: "listed_close",
    ticker,
    productKey: null,
    label,
    market: "korea",
    currency: "KRW",
    sourceRows: 1,
    accountCount: 1,
    storedMarketValueKrw,
  };
}

function component(instrumentRow, dates, prices) {
  return {
    instrument: instrumentRow,
    valuationBasis: "listed_close",
    valuations: dates.map((serviceDate, index) => ({
      serviceDate,
      priceDate: serviceDate,
      unitPriceKrw: prices[index],
    })),
    executions: [],
  };
}
