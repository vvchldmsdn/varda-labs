import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ADDITIONAL_CONTRIBUTION_SCOPE_POLICY,
  resolveAdditionalContributionScope,
} from "../src/lib/additional-contribution-scope.ts";

describe("additional contribution analysis scope", () => {
  it("admits a supported direct account without changing its authority", () => {
    assert.deepEqual(
      resolveAdditionalContributionScope({
        kind: "account",
        key: "account:11111111-1111-4111-8111-111111111111",
        label: "ISA",
        accountId: "11111111-1111-4111-8111-111111111111",
        accountCode: "isa",
      }),
      { state: "ready", account: "isa" },
    );
  });

  it("blocks aggregate and portfolio-group scopes without borrowing a policy", () => {
    assert.deepEqual(
      resolveAdditionalContributionScope({
        kind: "all",
        key: "all",
        label: "전체",
      }),
      { state: "blocked", reason: "aggregate_target_policy_not_defined" },
    );
    assert.deepEqual(
      resolveAdditionalContributionScope({
        kind: "portfolio_group",
        key: "portfolio:22222222-2222-4222-8222-222222222222",
        label: "장기 투자",
        portfolioGroupId: "22222222-2222-4222-8222-222222222222",
      }),
      {
        state: "blocked",
        reason: "portfolio_group_target_policy_not_defined",
      },
    );
    assert.equal(ADDITIONAL_CONTRIBUTION_SCOPE_POLICY.aggregateFallback, "forbidden");
  });

  it("blocks a dynamic account until the target-policy model supports it", () => {
    assert.deepEqual(
      resolveAdditionalContributionScope({
        kind: "account",
        key: "account:33333333-3333-4333-8333-333333333333",
        label: "별도 증권계좌",
        accountId: "33333333-3333-4333-8333-333333333333",
        accountCode: "brokerage-2",
      }),
      {
        state: "blocked",
        reason: "account_target_policy_model_unsupported",
      },
    );
  });
});
