import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInvestmentLabHistoricalAccountConsensus,
  resolveInvestmentLabEventAccount,
} from "../src/lib/investment-lab-event-account.ts";

describe("investment lab event account evidence", () => {
  it("uses explicit event metadata before weaker account evidence", () => {
    const result = resolveInvestmentLabEventAccount(
      event({ account: "isa", assetAccount: "brokerage" }),
      new Map([["legacy-a", "irp"]]),
    );

    assert.deepEqual(result, { account: "isa", source: "event_metadata" });
  });

  it("uses current asset account when event metadata is absent", () => {
    const result = resolveInvestmentLabEventAccount(
      event({ assetAccount: "irp" }),
      new Map([["legacy-a", "brokerage"]]),
    );

    assert.deepEqual(result, { account: "irp", source: "current_asset" });
  });

  it("uses exact legacy identity only when historical accounts agree", () => {
    const consensus = buildInvestmentLabHistoricalAccountConsensus([
      { legacyAssetId: "legacy-a", account: "brokerage" },
      { legacyAssetId: "legacy-a", account: "brokerage" },
      { legacyAssetId: "legacy-b", account: "isa" },
      { legacyAssetId: "legacy-b", account: "irp" },
      { legacyAssetId: "legacy-c", account: null },
    ]);

    assert.deepEqual(resolveInvestmentLabEventAccount(event(), consensus), {
      account: "brokerage",
      source: "historical_position_consensus",
    });
    assert.equal(consensus.has("legacy-b"), false);
    assert.equal(consensus.has("legacy-c"), false);
  });

  it("keeps unresolved evidence blocked without returning identity values", () => {
    const result = resolveInvestmentLabEventAccount(event(), new Map());

    assert.deepEqual(result, { account: null, source: "unresolved" });
    assert.doesNotMatch(JSON.stringify(result), /legacy-a/);
  });
});

function event(overrides = {}) {
  return {
    account: null,
    beforeValue: "{}",
    afterValue: "{}",
    assetAccount: null,
    legacyAssetId: "legacy-a",
    ...overrides,
  };
}
