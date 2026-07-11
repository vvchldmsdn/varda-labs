import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  HistoryImportArgumentError,
  buildBase44HistoryCanonicalPlan,
  parseBase44HistoryArgs,
} from "../scripts/lib/base44-history-canonical-plan.mjs";
import { normalizeBase44HistoryShadowSource } from "../scripts/lib/base44-history-shadow-source.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const LEGACY_OWNER = "base44-import-private";
const BALANCE_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const BALANCE_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const PORTFOLIO_A = "cccccccccccccccccccccccc";
const POSITION_A = "dddddddddddddddddddddddd";
const ASSET_A = "eeeeeeeeeeeeeeeeeeeeeeee";
const ASSET_MISSING = "ffffffffffffffffffffffff";
const FX_A = "111111111111111111111111";
const FX_B = "222222222222222222222222";

describe("Base44 history canonical owner Phase 1E-D", () => {
  it("requires an explicit candidate and hard-blocks canonical writes", () => {
    const parsed = parseBase44HistoryArgs(
      [
        "--canonical-owner-id",
        OWNER_A.toUpperCase(),
        "--approve-provisioning-owner",
      ],
      { defaultDataDir: "migration-data", legacyOwnerUserId: LEGACY_OWNER },
    );

    assert.equal(parsed.canonicalOwnerId, OWNER_A);
    assert.equal(parsed.approveProvisioningOwner, true);
    assert.equal(parsed.write, false);
    assert.throws(
      () =>
        parseBase44HistoryArgs(
          ["--canonical-owner-id", OWNER_A, "--write"],
          {
            defaultDataDir: "migration-data",
            legacyOwnerUserId: LEGACY_OWNER,
          },
        ),
      (error) =>
        error instanceof HistoryImportArgumentError &&
        error.code === "canonical_owner_write_not_enabled",
    );
    assert.throws(
      () => parseBase44HistoryArgs(["--canonical-owner-id", "invalid"]),
      (error) =>
        error instanceof HistoryImportArgumentError &&
        error.code === "invalid_canonical_owner_id",
    );
  });

  it("builds a minimal source contract without financial values", () => {
    const source = normalizeBase44HistoryShadowSource({
      balanceRecords: [
        { id: BALANCE_A, date: "2026-07-08", cash: 1000000 },
      ],
      portfolioRecords: [
        {
          id: PORTFOLIO_A,
          snapshot_date: "2026-07-08",
          account: "all",
          total_market_value: 9000000,
        },
      ],
      positionRecords: [
        {
          id: POSITION_A,
          snapshot_date: "2026-07-08",
          account: "brokerage",
          asset_id: ASSET_MISSING,
          ticker: "SECRET-TICKER",
          asset_name: "Private holding",
          market_value_krw: 8000000,
        },
      ],
      fxRateRecords: [
        {
          id: FX_A,
          date: "2026-07-08",
          usdkrw: 1500,
          source: "provider-label",
          status: "ok",
        },
      ],
    });
    const serialized = JSON.stringify(source);

    assert.equal(source.portfolios[0].source, "base44_import");
    assert.equal(source.positions[0].legacyAssetId, ASSET_MISSING);
    assert.doesNotMatch(serialized, /1000000|9000000|8000000|1500/);
    assert.doesNotMatch(serialized, /SECRET-TICKER|Private holding/);
  });

  it("plans a balance snapshot as one explicit-owner row", () => {
    const source = sourceState({
      balances: [sourceBalance(BALANCE_A)],
    });
    const state = databaseState({
      balances: [databaseBalance(BALANCE_A)],
    });
    const plan = buildPlan({ source, state });

    assert.equal(plan.result, "planned");
    assert.deepEqual(plan.tables.account_balance_snapshots, {
      insert: 0,
      update: 1,
      skip: 0,
      block: 0,
      sourceDuplicateIdentities: 0,
      databaseDuplicateIdentities: 0,
      sourceNaturalCollisions: 0,
      databaseNaturalCollisions: 0,
    });
    assert.equal(plan.plannedCanonicalAssignments, 1);
  });

  it("treats account all as a parent-less aggregate", () => {
    const source = sourceState({
      portfolios: [sourcePortfolio(PORTFOLIO_A, "all")],
    });
    const state = databaseState({
      portfolios: [databasePortfolio(PORTFOLIO_A, "all")],
    });
    const plan = buildPlan({ source, state });

    assert.equal(plan.result, "planned");
    assert.equal(plan.actions.update, 1);
    assert.equal(plan.references.account.not_applicable, 1);
    assert.equal(plan.reasonCounts.account_all_is_parentless_aggregate, 1);
  });

  it("uses fresh core proof for resolved null-owner account and asset parents", () => {
    const source = sourceState({
      portfolios: [sourcePortfolio(PORTFOLIO_A, "brokerage")],
      positions: [sourcePosition(POSITION_A, ASSET_A)],
    });
    const state = databaseState({
      portfolios: [
        databasePortfolio(PORTFOLIO_A, "brokerage", null, {
          accountId: "account-row",
        }),
      ],
      positions: [
        databasePosition(POSITION_A, ASSET_A, null, {
          accountId: "account-row",
          assetId: "asset-row",
        }),
      ],
      accounts: [account("brokerage", "account-row")],
      assets: [asset(ASSET_A, "asset-row")],
    });
    const proven = buildPlan({
      source,
      state,
      coreProof: freshCoreProof({
        accountCodes: ["brokerage"],
        assetLegacyIds: [ASSET_A],
      }),
    });
    const unproven = buildPlan({
      source,
      state,
      coreProof: unavailableCoreProof(),
    });

    assert.equal(proven.result, "planned");
    assert.equal(proven.references.account.compatible_planned, 2);
    assert.equal(proven.references.asset.compatible_planned, 1);
    assert.equal(unproven.result, "blocked");
    assert.equal(unproven.actions.block, 2);
  });

  it("accepts same-owner parents and blocks foreign or ambiguous parents", () => {
    const source = sourceState({
      portfolios: [sourcePortfolio(PORTFOLIO_A, "brokerage")],
    });
    const portfolio = databasePortfolio(PORTFOLIO_A, "brokerage", null, {
      accountId: "account-a",
    });
    const sameOwner = buildPlan({
      source,
      state: databaseState({
        portfolios: [portfolio],
        accounts: [account("brokerage", "account-a", OWNER_A)],
      }),
      coreProof: unavailableCoreProof(),
    });
    const foreignOwner = buildPlan({
      source,
      state: databaseState({
        portfolios: [portfolio],
        accounts: [account("brokerage", "account-a", OWNER_B)],
      }),
    });
    const ambiguous = buildPlan({
      source,
      state: databaseState({
        portfolios: [portfolio],
        accounts: [
          account("brokerage", "account-a"),
          account("brokerage", "account-b"),
        ],
      }),
    });

    assert.equal(sameOwner.result, "planned");
    assert.equal(sameOwner.references.account.compatible, 1);
    assert.equal(foreignOwner.result, "blocked");
    assert.equal(foreignOwner.reasonCounts.account_foreign_owner, 1);
    assert.equal(ambiguous.result, "blocked");
    assert.equal(ambiguous.reasonCounts.account_database_parent_ambiguous, 1);
  });

  it("preserves an unmatched position asset as legacy-only evidence", () => {
    const source = sourceState({
      positions: [sourcePosition(POSITION_A, ASSET_MISSING)],
    });
    const state = databaseState({
      positions: [databasePosition(POSITION_A, ASSET_MISSING)],
      accounts: [account("brokerage", "account-row", OWNER_A)],
    });
    state.positions[0] = {
      ...state.positions[0],
      accountId: "account-row",
    };
    const plan = buildPlan({ source, state });

    assert.equal(plan.result, "planned");
    assert.equal(plan.actions.update, 1);
    assert.equal(plan.references.asset.legacy_only_reference, 1);
    assert.equal(plan.reasonCounts.asset_database_parent_missing, 1);
  });

  it("blocks legacy identity duplicates without selecting a candidate", () => {
    const duplicateSource = buildPlan({
      source: sourceState({
        balances: [
          sourceBalance(BALANCE_A),
          sourceBalance(BALANCE_A, "2026-07-09"),
        ],
      }),
      state: databaseState(),
    });
    const duplicateDatabase = buildPlan({
      source: sourceState({ balances: [sourceBalance(BALANCE_A)] }),
      state: databaseState({
        balances: [
          databaseBalance(BALANCE_A),
          databaseBalance(BALANCE_A),
        ],
      }),
    });

    assert.equal(duplicateSource.result, "blocked");
    assert.equal(
      duplicateSource.tables.account_balance_snapshots
        .sourceDuplicateIdentities,
      1,
    );
    assert.equal(duplicateDatabase.result, "blocked");
    assert.equal(
      duplicateDatabase.tables.account_balance_snapshots
        .databaseDuplicateIdentities,
      1,
    );
  });

  it("blocks source and database natural-key collisions", () => {
    const sourceCollision = buildPlan({
      source: sourceState({
        balances: [sourceBalance(BALANCE_A), sourceBalance(BALANCE_B)],
      }),
      state: databaseState(),
    });
    const databaseCollision = buildPlan({
      source: sourceState({ balances: [sourceBalance(BALANCE_A)] }),
      state: databaseState({
        balances: [databaseBalance(BALANCE_B)],
      }),
    });

    assert.equal(sourceCollision.result, "blocked");
    assert.equal(
      sourceCollision.tables.account_balance_snapshots
        .sourceNaturalCollisions,
      1,
    );
    assert.equal(databaseCollision.result, "blocked");
    assert.equal(
      databaseCollision.tables.account_balance_snapshots
        .databaseNaturalCollisions,
      1,
    );
  });

  it("keeps shared FX diagnostics separate from snapshot ownership", () => {
    const source = sourceState({
      balances: [sourceBalance(BALANCE_A)],
      fxRates: [
        sourceFx(FX_A, "2026-07-08", "ok"),
        sourceFx(FX_B, "2026-07-08", "empty"),
      ],
    });
    const state = databaseState({
      balances: [databaseBalance(BALANCE_A)],
      fxRates: [
        databaseFx(FX_A, "2026-07-08"),
        databaseFx(FX_B, "2026-07-08"),
      ],
    });
    const plan = buildPlan({ source, state });

    assert.equal(plan.result, "planned");
    assert.equal(plan.actions.update, 1);
    assert.equal(plan.sharedFx.result, "needs_review");
    assert.equal(plan.sharedFx.ownerActions, 0);
    assert.equal(plan.sharedFx.diagnostics.sourceDuplicateDateGroups, 1);
    assert.equal(plan.sharedFx.diagnostics.databaseDuplicateDateGroups, 1);
    assert.equal(plan.sharedFx.diagnostics.nonOkStatusRows, 1);
  });

  it("returns aggregate plans and fingerprints without identifiers or values", () => {
    const plan = buildPlan({
      source: sourceState({
        balances: [sourceBalance(BALANCE_A)],
        portfolios: [sourcePortfolio(PORTFOLIO_A, "brokerage")],
        positions: [sourcePosition(POSITION_A, ASSET_A)],
        fxRates: [sourceFx(FX_A)],
      }),
      state: databaseState({
        balances: [databaseBalance(BALANCE_A)],
        portfolios: [
          databasePortfolio(PORTFOLIO_A, "brokerage", null, {
            accountId: "account-row",
          }),
        ],
        positions: [
          databasePosition(POSITION_A, ASSET_A, null, {
            accountId: "account-row",
            assetId: "asset-row",
          }),
        ],
        fxRates: [databaseFx(FX_A)],
        accounts: [account("brokerage", "account-row")],
        assets: [asset(ASSET_A, "asset-row")],
      }),
      coreProof: freshCoreProof({
        accountCodes: ["brokerage"],
        assetLegacyIds: [ASSET_A],
      }),
    });
    const serialized = JSON.stringify(plan);

    for (const value of [
      OWNER_A,
      OWNER_B,
      LEGACY_OWNER,
      BALANCE_A,
      PORTFOLIO_A,
      POSITION_A,
      ASSET_A,
      FX_A,
      "account-row",
      "asset-row",
    ]) {
      assert.doesNotMatch(serialized, new RegExp(value, "i"));
    }
    assert.doesNotMatch(serialized, /\b[0-9a-f]{24}\b/i);
    assert.equal(plan.actualWriteAllowed, false);
    assert.equal(plan.canonicalOwnerWriteEnabled, false);
    assert.equal(plan.databaseSideEffects, false);
    for (const fingerprint of Object.values(plan.fingerprints)) {
      assert.match(fingerprint, /^sha256:[0-9a-f]{16}$/);
    }
  });

  it("keeps state loaders read-only and exits before legacy history DML", () => {
    const stateSource = readFileSync(
      join(process.cwd(), "scripts/lib/base44-history-canonical-state.mjs"),
      "utf8",
    );
    const shadowSource = readFileSync(
      join(process.cwd(), "scripts/lib/base44-history-shadow-source.mjs"),
      "utf8",
    );
    const snapshotPlanSource = readFileSync(
      join(process.cwd(), "scripts/lib/base44-history-snapshot-plan.mjs"),
      "utf8",
    );
    const fxDiagnosticSource = readFileSync(
      join(process.cwd(), "scripts/lib/base44-history-fx-diagnostic.mjs"),
      "utf8",
    );
    const importSource = readFileSync(
      join(process.cwd(), "scripts/import-base44-history.mjs"),
      "utf8",
    );
    const dmlPattern =
      /\b(?:insert\s+into|update\s+[a-z_"]+\s+set|delete\s+from|truncate)\b/i;

    assert.doesNotMatch(stateSource, dmlPattern);
    assert.doesNotMatch(shadowSource, dmlPattern);
    assert.doesNotMatch(snapshotPlanSource, dmlPattern);
    assert.doesNotMatch(fxDiagnosticSource, dmlPattern);
    assert.match(
      importSource,
      /if \(args\.canonicalOwnerId !== null\)[\s\S]*?return;\s*}\s*\n\s*const balances =/,
    );
    assert.doesNotMatch(importSource, /dataDir:\s*args\.dataDir/);
    assert.doesNotMatch(importSource, /ownerUserId:\s*args\.ownerUserId/);
    assert.doesNotMatch(importSource, /console\.error\(error\)/);
    assert.doesNotMatch(
      importSource,
      /canonical_owner_user_id\s*=|canonical_owner_user_id\s*[,)]/i,
    );
  });
});

function buildPlan({
  source = sourceState(),
  state = databaseState(),
  coreProof = freshCoreProof(),
  appUser = { status: "provisioning", role: "user" },
} = {}) {
  return buildBase44HistoryCanonicalPlan({
    canonicalOwnerId: OWNER_A,
    approveProvisioningOwner: true,
    legacyOwnerUserId: LEGACY_OWNER,
    appUser,
    source,
    state,
    coreProof,
  });
}

function sourceState(overrides = {}) {
  return {
    balances: [],
    portfolios: [],
    positions: [],
    fxRates: [],
    ...overrides,
  };
}

function databaseState(overrides = {}) {
  return {
    balances: [],
    portfolios: [],
    positions: [],
    fxRates: [],
    accounts: [],
    assets: [],
    ...overrides,
  };
}

function sourceBalance(legacyBase44Id, balanceDate = "2026-07-08") {
  return { legacyBase44Id, balanceDate };
}

function databaseBalance(
  legacyBase44Id,
  canonicalOwnerUserId = null,
  balanceDate = "2026-07-08",
) {
  return {
    id: `balance-row-${legacyBase44Id.slice(0, 4)}`,
    legacyBase44Id,
    canonicalOwnerUserId,
    balanceDate,
  };
}

function sourcePortfolio(legacyBase44Id, accountCode) {
  return {
    legacyBase44Id,
    snapshotDate: "2026-07-08",
    account: accountCode,
    source: "base44_import",
  };
}

function databasePortfolio(
  legacyBase44Id,
  accountCode,
  canonicalOwnerUserId = null,
  overrides = {},
) {
  return {
    id: `portfolio-row-${legacyBase44Id.slice(0, 4)}`,
    legacyBase44Id,
    canonicalOwnerUserId,
    snapshotDate: "2026-07-08",
    account: accountCode,
    source: "base44_import",
    accountId: null,
    ...overrides,
  };
}

function sourcePosition(legacyBase44Id, legacyAssetId) {
  return {
    legacyBase44Id,
    snapshotDate: "2026-07-08",
    account: "brokerage",
    legacyAssetId,
    source: "base44_import",
  };
}

function databasePosition(
  legacyBase44Id,
  legacyAssetId,
  canonicalOwnerUserId = null,
  overrides = {},
) {
  return {
    id: `position-row-${legacyBase44Id.slice(0, 4)}`,
    legacyBase44Id,
    canonicalOwnerUserId,
    snapshotDate: "2026-07-08",
    account: "brokerage",
    source: "base44_import",
    legacyAssetId,
    accountId: null,
    assetId: null,
    ...overrides,
  };
}

function sourceFx(
  legacyBase44Id,
  rateDate = "2026-07-08",
  status = "ok",
) {
  return {
    legacyBase44Id,
    rateDate,
    status,
    source: "provider-label",
    isSample: false,
  };
}

function databaseFx(legacyBase44Id, rateDate = "2026-07-08") {
  return {
    id: `fx-row-${legacyBase44Id.slice(0, 4)}`,
    legacyBase44Id,
    rateDate,
    status: "ok",
    source: "provider-label",
  };
}

function account(code, id, canonicalOwnerUserId = null) {
  return { id, code, canonicalOwnerUserId };
}

function asset(legacyBase44Id, id, canonicalOwnerUserId = null) {
  return { id, legacyBase44Id, canonicalOwnerUserId };
}

function freshCoreProof({ accountCodes = [], assetLegacyIds = [] } = {}) {
  return {
    result: "planned",
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled: false,
    databaseSideEffects: false,
    accountCodes,
    assetLegacyIds,
  };
}

function unavailableCoreProof() {
  return {
    result: "blocked",
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled: false,
    databaseSideEffects: false,
    accountCodes: [],
    assetLegacyIds: [],
  };
}
