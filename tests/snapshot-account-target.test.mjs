import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveSnapshotAccountTargets } from "../src/lib/snapshots/account-target.ts";
import {
  isSnapshotInvestmentAssetType,
  SNAPSHOT_INVESTMENT_ASSET_TYPES,
} from "../src/lib/snapshots/investment-eligibility.ts";

describe("snapshot account target resolution", () => {
  const dynamicAccount = "acct_11111111111141118111111111111111";
  const activeAccountCodes = ["cash", "brokerage", dynamicAccount];
  const openInvestmentAccountCodes = new Set(["brokerage", dynamicAccount]);

  it("selects every active account with an open investment position", () => {
    assert.deepEqual(
      resolveSnapshotAccountTargets({
        activeAccountCodes,
        openInvestmentAccountCodes,
        requestedAccount: "all",
      }),
      {
        ok: true,
        targetAccounts: ["brokerage", dynamicAccount],
      },
    );
  });

  it("accepts an eligible generated account code", () => {
    assert.deepEqual(
      resolveSnapshotAccountTargets({
        activeAccountCodes,
        openInvestmentAccountCodes,
        requestedAccount: dynamicAccount,
      }),
      { ok: true, targetAccounts: [dynamicAccount] },
    );
  });

  it("fails closed for cash, empty, unknown, and malformed account requests", () => {
    assert.equal(
      resolveSnapshotAccountTargets({
        activeAccountCodes,
        openInvestmentAccountCodes,
        requestedAccount: "cash",
      }).reason,
      "account_has_no_open_investment_positions",
    );
    assert.equal(
      resolveSnapshotAccountTargets({
        activeAccountCodes,
        openInvestmentAccountCodes,
        requestedAccount: "missing",
      }).reason,
      "account_not_owned_or_inactive",
    );
    assert.equal(
      resolveSnapshotAccountTargets({
        activeAccountCodes: ["brokerage", "brokerage"],
        openInvestmentAccountCodes,
        requestedAccount: "all",
      }).reason,
      "invalid_account_catalog",
    );
    assert.equal(
      resolveSnapshotAccountTargets({
        activeAccountCodes: ["Brokerage"],
        openInvestmentAccountCodes,
        requestedAccount: "all",
      }).reason,
      "invalid_account_catalog",
    );
  });

  it("does not produce an empty all-account snapshot", () => {
    assert.deepEqual(
      resolveSnapshotAccountTargets({
        activeAccountCodes,
        openInvestmentAccountCodes: new Set(),
        requestedAccount: "all",
      }),
      { ok: false, reason: "no_open_investment_accounts" },
    );
  });

  it("keeps the shared investment-asset policy narrow and legacy compatible", () => {
    assert.deepEqual(SNAPSHOT_INVESTMENT_ASSET_TYPES, [
      "etf",
      "stock",
      "pension",
      "commodity",
    ]);
    assert.equal(isSnapshotInvestmentAssetType(null), true);
    assert.equal(isSnapshotInvestmentAssetType("cash"), false);
    assert.equal(isSnapshotInvestmentAssetType("deposit"), false);
  });
});
