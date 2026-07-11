import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  MarketContextImportArgumentError,
  buildBase44MarketContextCanonicalPlan,
  parseBase44MarketContextArgs,
} from "../scripts/lib/base44-market-context-canonical-plan.mjs";
import { normalizeBase44MarketContextShadowSource } from "../scripts/lib/base44-market-context-shadow-source.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const LEGACY_OWNER = "base44-import-private";
const REGIME_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const REGIME_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const FACTOR_A = "dddddddddddddddddddddddd";
const FACTOR_B = "eeeeeeeeeeeeeeeeeeeeeeee";
const FACTOR_C = "ffffffffffffffffffffffff";

describe("Base44 market context canonical owner Phase 1E-E", () => {
  it("requires an explicit candidate and hard-blocks canonical writes", () => {
    const parsed = parseBase44MarketContextArgs(
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
        parseBase44MarketContextArgs(
          ["--canonical-owner-id", OWNER_A, "--write"],
          {
            defaultDataDir: "migration-data",
            legacyOwnerUserId: LEGACY_OWNER,
          },
        ),
      (error) =>
        error instanceof MarketContextImportArgumentError &&
        error.code === "canonical_owner_write_not_enabled",
    );
    assert.throws(
      () =>
        parseBase44MarketContextArgs([
          "--canonical-owner-id",
          "invalid",
        ]),
      (error) =>
        error instanceof MarketContextImportArgumentError &&
        error.code === "invalid_canonical_owner_id",
    );
  });

  it("normalizes optional regime and distinct factor health evidence", () => {
    const source = normalizeBase44MarketContextShadowSource({
      marketRegimeRecords: [{ id: REGIME_A, date: "2026-07-10" }],
      globalFactorRecords: [
        {
          id: FACTOR_A,
          date: "2026-07-10",
          factor_key: "factor-a",
          status: "preliminary",
          is_estimated: true,
          is_preliminary: false,
          value: 999999,
          source_url: "https://provider.invalid/private",
          derived_metrics_json: { confidential: true },
        },
      ],
    });
    const serialized = JSON.stringify(source);

    assert.equal(source.marketRegimes[0].account, "all");
    assert.equal(source.marketRegimes[0].labelPresent, false);
    assert.equal(source.marketRegimes[0].driversPresent, false);
    assert.equal(source.globalFactors[0].status, "preliminary");
    assert.equal(source.globalFactors[0].isEstimated, true);
    assert.equal(source.globalFactors[0].isPreliminary, false);
    assert.doesNotMatch(serialized, /999999|provider\.invalid|confidential/);
  });

  it("treats account all as an explicit-owner parent-less aggregate", () => {
    const source = sourceState({
      marketRegimes: [sourceRegime(REGIME_A, "all")],
    });
    const state = databaseState({
      marketRegimes: [databaseRegime(REGIME_A, "all")],
    });
    const plan = buildPlan({ source, state });

    assert.equal(plan.result, "planned");
    assert.equal(plan.marketRegimeOwnerPlan.actions.update, 1);
    assert.equal(
      plan.marketRegimeOwnerPlan.references.account.not_applicable,
      1,
    );
  });

  it("requires fresh core proof for a resolved null-owner named account", () => {
    const source = sourceState({
      marketRegimes: [sourceRegime(REGIME_A, "brokerage")],
    });
    const state = databaseState({
      marketRegimes: [
        databaseRegime(REGIME_A, "brokerage", null, {
          accountId: "account-row",
        }),
      ],
      accounts: [account("brokerage", "account-row")],
    });
    const proven = buildPlan({
      source,
      state,
      coreProof: freshCoreProof(["brokerage"]),
    });
    const unproven = buildPlan({
      source,
      state,
      coreProof: unavailableCoreProof(),
    });

    assert.equal(proven.result, "planned");
    assert.equal(
      proven.marketRegimeOwnerPlan.references.account.compatible_planned,
      1,
    );
    assert.equal(unproven.result, "blocked");
    assert.equal(unproven.marketRegimeOwnerPlan.actions.block, 1);
  });

  it("accepts same-owner accounts and blocks foreign or ambiguous parents", () => {
    const source = sourceState({
      marketRegimes: [sourceRegime(REGIME_A, "brokerage")],
    });
    const regime = databaseRegime(REGIME_A, "brokerage", null, {
      accountId: "account-a",
    });
    const sameOwner = buildPlan({
      source,
      state: databaseState({
        marketRegimes: [regime],
        accounts: [account("brokerage", "account-a", OWNER_A)],
      }),
      coreProof: unavailableCoreProof(),
    });
    const foreign = buildPlan({
      source,
      state: databaseState({
        marketRegimes: [regime],
        accounts: [account("brokerage", "account-a", OWNER_B)],
      }),
    });
    const ambiguous = buildPlan({
      source,
      state: databaseState({
        marketRegimes: [regime],
        accounts: [
          account("brokerage", "account-a"),
          account("brokerage", "account-b"),
        ],
      }),
    });

    assert.equal(sameOwner.result, "planned");
    assert.equal(
      sameOwner.marketRegimeOwnerPlan.references.account.compatible,
      1,
    );
    assert.equal(foreign.result, "blocked");
    assert.equal(
      foreign.marketRegimeOwnerPlan.reasonCounts.account_foreign_owner,
      1,
    );
    assert.equal(ambiguous.result, "blocked");
    assert.equal(
      ambiguous.marketRegimeOwnerPlan.reasonCounts
        .account_database_parent_ambiguous,
      1,
    );
  });

  it("preserves same-context date/account duplicates as separate rows", () => {
    const source = sourceState({
      marketRegimes: [
        sourceRegime(REGIME_A, "brokerage"),
        sourceRegime(REGIME_B, "brokerage"),
      ],
    });
    const state = databaseState({
      marketRegimes: [
        databaseRegime(REGIME_A, "brokerage", null, {
          accountId: "account-row",
        }),
        databaseRegime(REGIME_B, "brokerage", null, {
          accountId: "account-row",
        }),
      ],
      accounts: [account("brokerage", "account-row")],
    });
    const plan = buildPlan({
      source,
      state,
      coreProof: freshCoreProof(["brokerage"]),
    });

    assert.equal(plan.result, "planned");
    assert.equal(plan.marketRegimeOwnerPlan.actions.update, 2);
    assert.equal(plan.marketRegimeOwnerPlan.actions.block, 0);
    assert.equal(plan.marketRegimeOwnerPlan.dataHealth.result, "needs_review");
    assert.deepEqual(
      plan.marketRegimeOwnerPlan.dataHealth.duplicateDateAccount,
      {
        sourceGroups: 1,
        sourceRows: 2,
        databaseGroups: 1,
        databaseRows: 2,
      },
    );
  });

  it("blocks an entire duplicate regime group with a foreign owner", () => {
    const source = sourceState({
      marketRegimes: [
        sourceRegime(REGIME_A, "brokerage"),
        sourceRegime(REGIME_B, "brokerage"),
      ],
    });
    const state = databaseState({
      marketRegimes: [
        databaseRegime(REGIME_A, "brokerage", OWNER_B, {
          accountId: "account-row",
        }),
        databaseRegime(REGIME_B, "brokerage", null, {
          accountId: "account-row",
        }),
      ],
      accounts: [account("brokerage", "account-row")],
    });
    const plan = buildPlan({
      source,
      state,
      coreProof: freshCoreProof(["brokerage"]),
    });

    assert.equal(plan.result, "blocked");
    assert.equal(plan.marketRegimeOwnerPlan.actions.block, 2);
    assert.equal(
      plan.marketRegimeOwnerPlan.identityDiagnostics.blockedDuplicateGroups,
      1,
    );
    assert.equal(
      plan.marketRegimeOwnerPlan.reasonCounts
        .duplicate_regime_group_owner_contract_blocked,
      2,
    );
  });

  it("blocks regime identity ambiguity without treating natural duplicates as identity", () => {
    const sourceDuplicate = buildPlan({
      source: sourceState({
        marketRegimes: [
          sourceRegime(REGIME_A, "all"),
          sourceRegime(REGIME_A, "all"),
        ],
      }),
      state: databaseState(),
    });
    const databaseDuplicate = buildPlan({
      source: sourceState({
        marketRegimes: [sourceRegime(REGIME_A, "all")],
      }),
      state: databaseState({
        marketRegimes: [
          databaseRegime(REGIME_A, "all"),
          databaseRegime(REGIME_A, "all"),
        ],
      }),
    });

    assert.equal(sourceDuplicate.result, "blocked");
    assert.equal(
      sourceDuplicate.marketRegimeOwnerPlan.identityDiagnostics
        .sourceDuplicateIdentities,
      1,
    );
    assert.equal(databaseDuplicate.result, "blocked");
    assert.equal(
      databaseDuplicate.marketRegimeOwnerPlan.identityDiagnostics
        .databaseDuplicateIdentities,
      1,
    );
  });

  it("reports incomplete optional regime payload without blocking ownership", () => {
    const source = sourceState({
      marketRegimes: [
        sourceRegime(REGIME_A, "all", {
          labelPresent: false,
          driversPresent: false,
        }),
      ],
    });
    const plan = buildPlan({
      source,
      state: databaseState({
        marketRegimes: [databaseRegime(REGIME_A, "all")],
      }),
    });

    assert.equal(plan.result, "planned");
    assert.equal(plan.marketRegimeOwnerPlan.actions.update, 1);
    assert.equal(plan.marketRegimeOwnerPlan.dataHealth.result, "needs_review");
    assert.deepEqual(plan.marketRegimeOwnerPlan.dataHealth.payload, {
      missingLabelRows: 1,
      missingDriversRows: 1,
      incompleteRows: 1,
    });
  });

  it("keeps factor status, estimated, and current preliminary evidence separate", () => {
    const statuses = [
      "ok",
      "revised",
      "preliminary",
      "non_trading",
      "missing",
      "fetch_failed",
      "unexpected",
      null,
    ];
    const factors = statuses.map((status, index) =>
      sourceFactor(factorId(index), {
        factorDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        statusPresent: status !== null,
        status,
        estimatedPresent: index !== 7,
        isEstimated: index === 0 ? true : index === 6 ? null : false,
        preliminaryPresent: true,
        isPreliminary: index === 2,
      }),
    );
    const plan = buildPlan({
      source: sourceState({ globalFactors: factors }),
      state: databaseState({
        globalFactors: factors.map((factor) => databaseFactor(factor)),
      }),
    });
    const health = plan.globalFactorDiagnostic.healthEvidence;

    assert.equal(plan.result, "planned");
    assert.equal(plan.globalFactorDiagnostic.result, "needs_review");
    assert.deepEqual(health.status, {
      ok: 1,
      revised: 1,
      preliminary: 1,
      non_trading: 1,
      missing: 1,
      fetch_failed: 1,
      absent: 1,
      unknown: 1,
    });
    assert.deepEqual(health.estimated, {
      true: 1,
      false: 5,
      absent: 1,
      unknown: 1,
    });
    assert.deepEqual(health.currentPreliminary, {
      true: 1,
      false: 7,
      absent: 0,
      unknown: 0,
    });
  });

  it("preserves factor natural duplicates but blocks factor identity duplicates only", () => {
    const naturalFactors = [
      sourceFactor(FACTOR_A),
      sourceFactor(FACTOR_B),
    ];
    const naturalDuplicate = buildPlan({
      source: sourceState({ globalFactors: naturalFactors }),
      state: databaseState({
        globalFactors: naturalFactors.map((factor) => databaseFactor(factor)),
      }),
    });
    const identityDuplicate = buildPlan({
      source: sourceState({
        marketRegimes: [sourceRegime(REGIME_A, "all")],
        globalFactors: [sourceFactor(FACTOR_C), sourceFactor(FACTOR_C)],
      }),
      state: databaseState({
        marketRegimes: [databaseRegime(REGIME_A, "all")],
      }),
    });

    assert.equal(naturalDuplicate.result, "planned");
    assert.equal(naturalDuplicate.globalFactorDiagnostic.result, "needs_review");
    assert.equal(
      naturalDuplicate.globalFactorDiagnostic.naturalKeyDiagnostics
        .sourceDuplicateGroups,
      1,
    );
    assert.equal(identityDuplicate.result, "planned");
    assert.equal(identityDuplicate.globalFactorDiagnostic.result, "blocked");
    assert.equal(identityDuplicate.globalFactorDiagnostic.ownerActions, 0);
  });

  it("returns only aggregate counts and fingerprints", () => {
    const source = sourceState({
      marketRegimes: [sourceRegime(REGIME_A, "brokerage")],
      globalFactors: [sourceFactor(FACTOR_A)],
    });
    const state = databaseState({
      marketRegimes: [
        databaseRegime(REGIME_A, "brokerage", null, {
          accountId: "account-row",
        }),
      ],
      accounts: [account("brokerage", "account-row")],
      globalFactors: [databaseFactor(source.globalFactors[0])],
    });
    const plan = buildPlan({
      source,
      state,
      coreProof: freshCoreProof(["brokerage"]),
    });
    const serialized = JSON.stringify(plan);

    for (const value of [
      OWNER_A,
      OWNER_B,
      LEGACY_OWNER,
      REGIME_A,
      FACTOR_A,
      "account-row",
      "factor-a",
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

  it("keeps shadow modules read-only and exits before legacy DML", () => {
    const files = [
      "base44-market-context-canonical-state.mjs",
      "base44-market-context-shadow-source.mjs",
      "base44-market-regime-owner-plan.mjs",
      "base44-global-factor-diagnostic.mjs",
      "base44-market-context-canonical-plan.mjs",
    ].map((file) =>
      readFileSync(join(process.cwd(), "scripts/lib", file), "utf8"),
    );
    const importSource = readFileSync(
      join(process.cwd(), "scripts/import-base44-market-context.mjs"),
      "utf8",
    );
    const dmlPattern =
      /\b(?:insert\s+into|update\s+[a-z_"]+\s+set|delete\s+from|truncate)\b/i;

    for (const source of files) assert.doesNotMatch(source, dmlPattern);
    assert.match(
      importSource,
      /if \(args\.canonicalOwnerId !== null\)[\s\S]*?return;\s*}\s*\n\s*const marketRegimes =/,
    );
    assert.match(
      importSource,
      /account:\s*requiredString\(record\.account,[\s\S]*?label:\s*requiredString\(record\.label,[\s\S]*?driversJson:\s*requiredJson\(/,
    );
    assert.match(
      importSource,
      /GLOBAL_MARKET_FACTOR_SHADOW_FIELDS[\s\S]*?"status"[\s\S]*?"is_estimated"/,
    );
    assert.doesNotMatch(importSource, /dataDir:\s*args\.dataDir/);
    assert.doesNotMatch(importSource, /ownerUserId:\s*args\.ownerUserId/);
    assert.doesNotMatch(importSource, /console\.error\(error\)/);
  });
});

function buildPlan({
  source = sourceState(),
  state = databaseState(),
  coreProof = freshCoreProof(),
  appUser = { status: "provisioning", role: "user" },
} = {}) {
  return buildBase44MarketContextCanonicalPlan({
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
  return { marketRegimes: [], globalFactors: [], ...overrides };
}

function databaseState(overrides = {}) {
  return {
    marketRegimes: [],
    globalFactors: [],
    accounts: [],
    ...overrides,
  };
}

function sourceRegime(legacyBase44Id, accountCode, overrides = {}) {
  return {
    legacyBase44Id,
    regimeDate: "2026-07-10",
    account: accountCode,
    labelPresent: true,
    driversPresent: true,
    isSample: false,
    ...overrides,
  };
}

function databaseRegime(
  legacyBase44Id,
  accountCode,
  canonicalOwnerUserId = null,
  overrides = {},
) {
  return {
    id: `regime-row-${legacyBase44Id.slice(0, 4)}`,
    legacyBase44Id,
    canonicalOwnerUserId,
    regimeDate: "2026-07-10",
    account: accountCode,
    accountId: null,
    ...overrides,
  };
}

function sourceFactor(legacyBase44Id, overrides = {}) {
  return {
    legacyBase44Id,
    factorDate: "2026-07-10",
    factorKey: "factor-a",
    statusPresent: true,
    status: "ok",
    estimatedPresent: true,
    isEstimated: false,
    preliminaryPresent: true,
    isPreliminary: false,
    isSample: false,
    ...overrides,
  };
}

function databaseFactor(sourceFactorRow) {
  return {
    id: `factor-row-${sourceFactorRow.legacyBase44Id.slice(0, 4)}`,
    legacyBase44Id: sourceFactorRow.legacyBase44Id,
    factorDate: sourceFactorRow.factorDate,
    factorKey: sourceFactorRow.factorKey,
  };
}

function factorId(index) {
  return index.toString(16).padStart(24, "0");
}

function account(code, id, canonicalOwnerUserId = null) {
  return { id, code, canonicalOwnerUserId };
}

function freshCoreProof(accountCodes = []) {
  return {
    result: "planned",
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled: false,
    databaseSideEffects: false,
    accountCodes,
  };
}

function unavailableCoreProof() {
  return {
    result: "blocked",
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled: false,
    databaseSideEffects: false,
    accountCodes: [],
  };
}
