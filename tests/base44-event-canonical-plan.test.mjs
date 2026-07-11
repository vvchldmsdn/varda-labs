import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  EventImportArgumentError,
  buildBase44EventCanonicalPlan,
  normalizeBase44EventShadowSource,
  parseBase44EventArgs,
} from "../scripts/lib/base44-event-canonical-plan.mjs";

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const LEGACY_OWNER = "base44-import-private";
const EVENT_A = "aaaaaaaaaaaaaaaaaaaaaaaa";
const EVENT_B = "bbbbbbbbbbbbbbbbbbbbbbbb";
const EVENT_C = "cccccccccccccccccccccccc";
const ASSET_A = "dddddddddddddddddddddddd";
const GROUP_A = "eeeeeeeeeeeeeeeeeeeeeeee";

describe("Base44 event canonical owner Phase 1E-C1", () => {
  it("requires an explicit candidate and blocks canonical actual writes", () => {
    const parsed = parseBase44EventArgs(
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
        parseBase44EventArgs(
          ["--canonical-owner-id", OWNER_A, "--write"],
          { defaultDataDir: "migration-data", legacyOwnerUserId: LEGACY_OWNER },
        ),
      (error) =>
        error instanceof EventImportArgumentError &&
        error.code === "canonical_owner_write_not_enabled",
    );
    assert.throws(
      () => parseBase44EventArgs(["--canonical-owner-id", "invalid"]),
      (error) =>
        error instanceof EventImportArgumentError &&
        error.code === "invalid_canonical_owner_id",
    );
  });

  it("accepts an assetless event shadow DTO without weakening legacy DML", () => {
    const source = normalizeBase44EventShadowSource({
      id: EVENT_A,
      event_date: "2026-07-11",
      event_type: "cash_adjustment",
      asset_id: null,
      asset_name: null,
      before_value: null,
      after_value: null,
    });
    const plan = buildPlan({
      sourceEvents: [source],
      state: stateWithEvents([databaseEvent(EVENT_A)]),
    });

    assert.equal(source.legacyAssetId, null);
    assert.equal(plan.result, "planned");
    assert.deepEqual(plan.actions, {
      insert: 0,
      update: 1,
      skip: 0,
      block: 0,
    });
    for (const kind of ["account", "asset", "group", "correction"]) {
      assert.equal(plan.references[kind].not_applicable, 1);
    }
  });

  it("preserves a missing legacy asset as unresolved evidence", () => {
    const source = sourceEvent(EVENT_A, { legacyAssetId: ASSET_A });
    const plan = buildPlan({
      sourceEvents: [source],
      state: stateWithEvents([databaseEvent(EVENT_A)]),
      coreProof: freshCoreProof({ assetLegacyIds: [ASSET_A] }),
    });

    assert.equal(plan.result, "planned");
    assert.equal(plan.actions.update, 1);
    assert.equal(plan.references.asset.legacy_only_reference, 1);
    assert.equal(plan.reasonCounts.asset_database_parent_missing, 1);
  });

  it("requires a fresh core proof for resolved null-owner parents", () => {
    const source = sourceEvent(EVENT_A, {
      account: "brokerage",
      legacyAssetId: ASSET_A,
      legacyGroupId: GROUP_A,
    });
    const state = stateWithEvents(
      [
        databaseEvent(EVENT_A, null, {
          accountId: "account-row",
          assetId: "asset-row",
          groupId: "group-row",
        }),
      ],
      {
        accounts: [account("brokerage", "account-row")],
        assets: [asset(ASSET_A, "asset-row")],
        groups: [group(GROUP_A, "group-row")],
      },
    );
    const proven = buildPlan({
      sourceEvents: [source],
      state,
      coreProof: freshCoreProof({
        accountCodes: ["brokerage"],
        assetLegacyIds: [ASSET_A],
        groupLegacyIds: [GROUP_A],
      }),
    });
    const unproven = buildPlan({
      sourceEvents: [source],
      state,
      coreProof: unavailableCoreProof(),
    });

    assert.equal(proven.result, "planned");
    assert.equal(proven.references.account.compatible_planned, 1);
    assert.equal(proven.references.asset.compatible_planned, 1);
    assert.equal(proven.references.group.compatible_planned, 1);
    assert.equal(unproven.result, "blocked");
    assert.equal(unproven.actions.block, 1);
    assert.equal(unproven.references.account.block, 1);
    assert.equal(unproven.references.asset.block, 1);
    assert.equal(unproven.references.group.block, 1);
  });

  it("accepts same-owner parents and blocks foreign or ambiguous parents", () => {
    const source = sourceEvent(EVENT_A, { account: "brokerage" });
    const sameOwner = buildPlan({
      sourceEvents: [source],
      state: stateWithEvents(
        [databaseEvent(EVENT_A, null, { accountId: "account-a" })],
        { accounts: [account("brokerage", "account-a", OWNER_A)] },
      ),
      coreProof: unavailableCoreProof(),
    });
    const foreignOwner = buildPlan({
      sourceEvents: [source],
      state: stateWithEvents(
        [databaseEvent(EVENT_A, null, { accountId: "account-b" })],
        { accounts: [account("brokerage", "account-b", OWNER_B)] },
      ),
    });
    const ambiguous = buildPlan({
      sourceEvents: [source],
      state: stateWithEvents(
        [databaseEvent(EVENT_A, null, { accountId: "account-a" })],
        {
          accounts: [
            account("brokerage", "account-a"),
            account("brokerage", "account-b"),
          ],
        },
      ),
    });

    assert.equal(sameOwner.result, "planned");
    assert.equal(sameOwner.references.account.compatible, 1);
    assert.equal(foreignOwner.result, "blocked");
    assert.equal(foreignOwner.reasonCounts.account_foreign_owner, 1);
    assert.equal(ambiguous.result, "blocked");
    assert.equal(ambiguous.reasonCounts.account_database_parent_ambiguous, 1);
  });

  it("keeps a missing correction unresolved and accepts a forward batch target", () => {
    const unresolved = buildPlan({
      sourceEvents: [
        sourceEvent(EVENT_A, { legacyCorrectsEventId: EVENT_C }),
      ],
      state: stateWithEvents([databaseEvent(EVENT_A)]),
    });
    const forward = buildPlan({
      sourceEvents: [
        sourceEvent(EVENT_A, { legacyCorrectsEventId: EVENT_B }),
        sourceEvent(EVENT_B),
      ],
      state: stateWithEvents([
        databaseEvent(EVENT_A),
        databaseEvent(EVENT_B),
      ]),
    });

    assert.equal(unresolved.result, "planned");
    assert.equal(unresolved.references.correction.legacy_only_reference, 1);
    assert.equal(unresolved.reasonCounts.unresolved_correction_reference, 1);
    assert.equal(forward.result, "planned");
    assert.equal(forward.actions.update, 2);
    assert.equal(forward.references.correction.compatible_planned, 1);
    assert.equal(forward.references.correction.not_applicable, 1);
  });

  it("blocks self references, cycles, and blocked same-batch targets", () => {
    const self = buildPlan({
      sourceEvents: [
        sourceEvent(EVENT_A, { legacyCorrectsEventId: EVENT_A }),
      ],
      state: stateWithEvents([databaseEvent(EVENT_A)]),
    });
    const cycle = buildPlan({
      sourceEvents: [
        sourceEvent(EVENT_A, { legacyCorrectsEventId: EVENT_B }),
        sourceEvent(EVENT_B, { legacyCorrectsEventId: EVENT_A }),
      ],
      state: stateWithEvents([
        databaseEvent(EVENT_A),
        databaseEvent(EVENT_B),
      ]),
    });
    const blockedTarget = buildPlan({
      sourceEvents: [
        sourceEvent(EVENT_A, { legacyCorrectsEventId: EVENT_B }),
        sourceEvent(EVENT_B, { account: "brokerage" }),
      ],
      state: stateWithEvents([
        databaseEvent(EVENT_A),
        databaseEvent(EVENT_B, null, { accountId: "foreign-account" }),
      ], {
        accounts: [account("brokerage", "foreign-account", OWNER_B)],
      }),
    });

    assert.equal(self.result, "blocked");
    assert.equal(self.reasonCounts.correction_self_reference, 1);
    assert.equal(cycle.result, "blocked");
    assert.equal(cycle.references.correction.block, 2);
    assert.equal(cycle.reasonCounts.correction_cycle, 2);
    assert.equal(blockedTarget.result, "blocked");
    assert.equal(blockedTarget.actions.block, 2);
    assert.equal(
      blockedTarget.reasonCounts.correction_same_batch_target_blocked,
      1,
    );
  });

  it("accepts same-owner external corrections and blocks foreign or ambiguous targets", () => {
    const sourceEvents = [
      sourceEvent(EVENT_A, { legacyCorrectsEventId: EVENT_C }),
    ];
    const sameOwner = buildPlan({
      sourceEvents,
      state: stateWithEvents([
        databaseEvent(EVENT_A, null, { correctsEventId: "target-row" }),
        databaseEvent(EVENT_C, OWNER_A, { id: "target-row" }),
      ]),
    });
    const foreignOwner = buildPlan({
      sourceEvents,
      state: stateWithEvents([
        databaseEvent(EVENT_A, null, { correctsEventId: "target-row" }),
        databaseEvent(EVENT_C, OWNER_B, { id: "target-row" }),
      ]),
    });
    const ambiguous = buildPlan({
      sourceEvents,
      state: stateWithEvents([
        databaseEvent(EVENT_A),
        databaseEvent(EVENT_C, OWNER_A, { id: "target-row-a" }),
        databaseEvent(EVENT_C, OWNER_A, { id: "target-row-b" }),
      ]),
    });

    assert.equal(sameOwner.result, "planned");
    assert.equal(sameOwner.references.correction.compatible, 1);
    assert.equal(foreignOwner.result, "blocked");
    assert.equal(foreignOwner.reasonCounts.correction_foreign_owner, 1);
    assert.equal(ambiguous.result, "blocked");
    assert.equal(ambiguous.reasonCounts.correction_target_ambiguous, 1);
  });

  it("blocks duplicate source and database event candidates", () => {
    const duplicateSource = buildPlan({
      sourceEvents: [sourceEvent(EVENT_A), sourceEvent(EVENT_A)],
      state: stateWithEvents([databaseEvent(EVENT_A)]),
    });
    const duplicateDatabase = buildPlan({
      sourceEvents: [sourceEvent(EVENT_A)],
      state: stateWithEvents([
        databaseEvent(EVENT_A),
        databaseEvent(EVENT_A, null, { id: "duplicate-event-row" }),
      ]),
    });

    assert.equal(duplicateSource.result, "blocked");
    assert.equal(duplicateSource.reasonCounts.duplicate_source_event_identity, 1);
    assert.equal(duplicateDatabase.result, "blocked");
    assert.equal(
      duplicateDatabase.reasonCounts.duplicate_database_event_identity,
      1,
    );
  });

  it("returns aggregate counts and fingerprints without identifiers or values", () => {
    const plan = buildPlan({
      sourceEvents: [
        sourceEvent(EVENT_A, {
          account: "brokerage",
          legacyAssetId: ASSET_A,
        }),
      ],
      state: stateWithEvents(
        [
          databaseEvent(EVENT_A, null, {
            accountId: "account-row",
            assetId: "asset-row",
          }),
        ],
        {
          accounts: [account("brokerage", "account-row")],
          assets: [asset(ASSET_A, "asset-row")],
        },
      ),
      coreProof: freshCoreProof({
        accountCodes: ["brokerage"],
        assetLegacyIds: [ASSET_A],
      }),
    });
    const serialized = JSON.stringify(plan);

    for (const value of [OWNER_A, OWNER_B, LEGACY_OWNER, EVENT_A, ASSET_A]) {
      assert.doesNotMatch(serialized, new RegExp(value, "i"));
    }
    assert.doesNotMatch(serialized, /\b[0-9a-f]{24}\b/i);
    assert.doesNotMatch(serialized, /account-row|asset-row/);
    assert.equal(plan.actualWriteAllowed, false);
    assert.equal(plan.canonicalOwnerWriteEnabled, false);
    assert.equal(plan.databaseSideEffects, false);
    for (const fingerprint of Object.values(plan.fingerprints)) {
      assert.match(fingerprint, /^sha256:[0-9a-f]{16}$/);
    }
  });

  it("keeps canonical loaders read-only and exits before legacy event DML", () => {
    const stateSource = readFileSync(
      join(process.cwd(), "scripts/lib/base44-event-canonical-state.mjs"),
      "utf8",
    );
    const coreSource = readFileSync(
      join(process.cwd(), "scripts/lib/base44-core-shadow-source.mjs"),
      "utf8",
    );
    const importSource = readFileSync(
      join(process.cwd(), "scripts/import-base44-events.mjs"),
      "utf8",
    );
    const dmlPattern =
      /\b(?:insert\s+into|update\s+[a-z_"]+\s+set|delete\s+from|truncate)\b/i;

    assert.doesNotMatch(stateSource, dmlPattern);
    assert.doesNotMatch(coreSource, dmlPattern);
    assert.match(
      importSource,
      /if \(args\.canonicalOwnerId !== null\)[\s\S]*?return;\s*}\s*\n\s*const events =/,
    );
    assert.equal(
      importSource.match(/update event_ledger_entries event/g)?.length,
      1,
    );
    assert.doesNotMatch(importSource, /dataDir:\s*args\.dataDir/);
    assert.doesNotMatch(importSource, /ownerUserId:\s*args\.ownerUserId/);
    assert.doesNotMatch(importSource, /console\.error\(error\)/);
  });
});

function buildPlan({
  sourceEvents = [sourceEvent(EVENT_A)],
  state = stateWithEvents([databaseEvent(EVENT_A)]),
  coreProof = freshCoreProof(),
  appUser = { status: "provisioning", role: "user" },
} = {}) {
  return buildBase44EventCanonicalPlan({
    canonicalOwnerId: OWNER_A,
    approveProvisioningOwner: true,
    legacyOwnerUserId: LEGACY_OWNER,
    appUser,
    sourceEvents,
    state,
    coreProof,
  });
}

function sourceEvent(legacyBase44Id, overrides = {}) {
  return {
    legacyBase44Id,
    eventDate: "2026-07-11",
    eventType: "buy",
    account: null,
    legacyAssetId: null,
    legacyGroupId: null,
    legacyCorrectsEventId: null,
    ...overrides,
  };
}

function databaseEvent(
  legacyBase44Id,
  canonicalOwnerUserId = null,
  overrides = {},
) {
  return {
    id: `event-row-${legacyBase44Id.slice(0, 4)}`,
    legacyBase44Id,
    canonicalOwnerUserId,
    accountId: null,
    assetId: null,
    groupId: null,
    correctsEventId: null,
    ...overrides,
  };
}

function account(code, id, canonicalOwnerUserId = null) {
  return { id, code, canonicalOwnerUserId };
}

function asset(legacyBase44Id, id, canonicalOwnerUserId = null) {
  return { id, legacyBase44Id, canonicalOwnerUserId };
}

function group(legacyBase44Id, id, canonicalOwnerUserId = null) {
  return { id, legacyBase44Id, canonicalOwnerUserId };
}

function stateWithEvents(events, overrides = {}) {
  return {
    events,
    accounts: [],
    assets: [],
    groups: [],
    ...overrides,
  };
}

function freshCoreProof({
  accountCodes = [],
  assetLegacyIds = [],
  groupLegacyIds = [],
} = {}) {
  return {
    result: "planned",
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled: false,
    databaseSideEffects: false,
    accountCodes,
    assetLegacyIds,
    groupLegacyIds,
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
    groupLegacyIds: [],
  };
}
