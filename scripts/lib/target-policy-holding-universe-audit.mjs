import { buildTargetPolicyHoldingUniverse } from "../../src/lib/target-policy-holding-universe.ts";

const ACCOUNTS = Object.freeze(["brokerage", "isa", "irp"]);

export function auditTargetPolicyHoldingUniverses({
  holdingsByAccount,
  beforeRowCount,
  afterRowCount,
}) {
  const accounts = Object.fromEntries(
    ACCOUNTS.map((account) => [
      account,
      buildTargetPolicyHoldingUniverse({
        account,
        holdings: holdingsByAccount[account] ?? [],
      }),
    ]),
  );
  const rowCountUnchanged = beforeRowCount === afterRowCount;

  return Object.freeze({
    audit: "target_policy_holding_universe_gate_b1",
    status: rowCountUnchanged ? "passed" : "failed",
    readOnly: true,
    databaseRowCounts: Object.freeze({
      before: Object.freeze({ assets: beforeRowCount }),
      after: Object.freeze({ assets: afterRowCount }),
      unchanged: rowCountUnchanged,
    }),
    summary: Object.freeze({
      reviewableAccounts: ACCOUNTS.filter(
        (account) => accounts[account].status === "reviewable",
      ),
      blockedAccounts: ACCOUNTS.filter(
        (account) => accounts[account].status === "blocked",
      ),
      totalHoldings: ACCOUNTS.reduce(
        (sum, account) => sum + accounts[account].summary.holdingCount,
        0,
      ),
    }),
    accounts: Object.freeze(accounts),
    boundaries: Object.freeze({
      databaseWrites: 0,
      providerCalls: 0,
      schemaChanges: 0,
      routeCalls: 0,
      allocatorCalls: 0,
      rawTargetReads: 0,
    }),
  });
}
