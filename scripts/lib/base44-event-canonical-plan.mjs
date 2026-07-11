import path from "node:path";

import {
  classifyCanonicalOwnerAction,
  isCanonicalUuid,
  prepareCanonicalMigrationShadowOwner,
  shadowFingerprint,
  summarizeCanonicalOwnerActions,
} from "./migration-canonical-owner-shadow.mjs";

const BASE44_ID_PATTERN = /^[0-9a-f]{24}$/i;
const REFERENCE_KINDS = ["account", "asset", "group", "correction"];
const REFERENCE_STATUSES = [
  "not_applicable",
  "legacy_only_reference",
  "compatible_planned",
  "compatible",
  "block",
];

export class EventImportArgumentError extends Error {
  constructor(code) {
    super("Base44 event import arguments are invalid");
    this.name = "EventImportArgumentError";
    this.code = code;
  }
}

export function parseBase44EventArgs(
  argv,
  {
    defaultDataDir = path.resolve(
      process.cwd(),
      "..",
      "gyeol-fin",
      "migration-data",
    ),
    legacyOwnerUserId = "base44-import",
  } = {},
) {
  const args = {
    dataDir: defaultDataDir,
    write: false,
    ownerUserId: legacyOwnerUserId,
    canonicalOwnerId: null,
    approveProvisioningOwner: false,
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--write" && !seen.has(arg)) {
      seen.add(arg);
      args.write = true;
      continue;
    }
    if (arg === "--approve-provisioning-owner" && !seen.has(arg)) {
      seen.add(arg);
      args.approveProvisioningOwner = true;
      continue;
    }
    if (
      ["--data-dir", "--owner-user-id", "--canonical-owner-id"].includes(
        arg,
      ) &&
      !seen.has(arg)
    ) {
      seen.add(arg);
      const value = argv[index + 1] ?? "";
      index += 1;
      if (arg === "--data-dir") args.dataDir = path.resolve(value);
      if (arg === "--owner-user-id") args.ownerUserId = value;
      if (arg === "--canonical-owner-id") {
        args.canonicalOwnerId = value.trim().toLowerCase();
      }
      continue;
    }
    throw new EventImportArgumentError("unsupported_or_duplicate_argument");
  }

  if (!args.ownerUserId.trim()) {
    throw new EventImportArgumentError("missing_legacy_owner_evidence");
  }
  if (
    args.canonicalOwnerId !== null &&
    !isCanonicalUuid(args.canonicalOwnerId)
  ) {
    throw new EventImportArgumentError("invalid_canonical_owner_id");
  }
  if (args.approveProvisioningOwner && args.canonicalOwnerId === null) {
    throw new EventImportArgumentError("approval_without_canonical_owner");
  }
  if (args.write && args.canonicalOwnerId !== null) {
    throw new EventImportArgumentError("canonical_owner_write_not_enabled");
  }

  return Object.freeze(args);
}

export function normalizeBase44EventShadowSource(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new EventImportArgumentError("invalid_event_source_record");
  }

  return Object.freeze({
    legacyBase44Id: requiredBase44Id(record.id, "invalid_event_identity"),
    eventDate: requiredDate(record.event_date),
    eventType: requiredString(record.event_type, "missing_event_type"),
    account: optionalString(record.account),
    legacyAssetId: optionalBase44Id(
      record.asset_id,
      "invalid_event_asset_reference",
    ),
    legacyGroupId: optionalBase44Id(
      record.group_id,
      "invalid_event_group_reference",
    ),
    legacyCorrectsEventId: optionalBase44Id(
      record.corrects_event_id,
      "invalid_event_correction_reference",
    ),
  });
}

export function buildBase44EventCanonicalPlan({
  canonicalOwnerId,
  approveProvisioningOwner,
  legacyOwnerUserId,
  appUser,
  sourceEvents,
  state,
  coreProof,
}) {
  assertPlanInputs(sourceEvents, state);
  const ownerPreparation = prepareCanonicalMigrationShadowOwner({
    canonicalOwnerId,
    approveProvisioningOwner,
    legacyOwnerUserId,
    appUser,
  });
  const globalReasons = [...ownerPreparation.blockers];
  const sourceIndex = indexBy(sourceEvents, "legacyBase44Id");
  const databaseEventIndex = indexBy(state.events, "legacyBase44Id");
  const accountIndex = indexBy(state.accounts, "code");
  const assetIndex = indexBy(state.assets, "legacyBase44Id");
  const groupIndex = indexBy(state.groups, "legacyBase44Id");
  const duplicateSourceIdentityCount = duplicateKeyCount(sourceIndex);
  const duplicateDatabaseIdentityCount = [...sourceIndex.keys()].filter(
    (key) => (databaseEventIndex.get(key)?.length ?? 0) > 1,
  ).length;

  if (duplicateSourceIdentityCount > 0) {
    globalReasons.push("duplicate_source_event_identity");
  }
  if (duplicateDatabaseIdentityCount > 0) {
    globalReasons.push("duplicate_database_event_identity");
  }

  const globalBlock = globalReasons.length > 0;
  const eventRows = [];
  const actionBySourceIdentity = new Map();
  const referenceResults = Object.fromEntries(
    REFERENCE_KINDS.map((kind) => [kind, []]),
  );
  const coreProofState = normalizeCoreProof(coreProof);

  for (const sourceEvent of sourceEvents) {
    const databaseCandidates =
      databaseEventIndex.get(sourceEvent.legacyBase44Id) ?? [];
    const databaseEvent =
      databaseCandidates.length === 1 ? databaseCandidates[0] : null;
    let action = classifyCanonicalOwnerAction({
      exists: databaseEvent !== null,
      existingCanonicalOwnerId:
        databaseEvent?.canonicalOwnerUserId ?? null,
      canonicalOwnerId,
      blocked: globalBlock || databaseCandidates.length > 1,
    });

    const account = evaluateParentReference({
      kind: "account",
      reference: sourceEvent.account,
      databaseEvent,
      eventLinkField: "accountId",
      candidates: accountIndex.get(sourceEvent.account) ?? [],
      canonicalOwnerId,
      coreProofState,
    });
    const asset = evaluateParentReference({
      kind: "asset",
      reference: sourceEvent.legacyAssetId,
      databaseEvent,
      eventLinkField: "assetId",
      candidates: assetIndex.get(sourceEvent.legacyAssetId) ?? [],
      canonicalOwnerId,
      coreProofState,
    });
    const group = evaluateParentReference({
      kind: "group",
      reference: sourceEvent.legacyGroupId,
      databaseEvent,
      eventLinkField: "groupId",
      candidates: groupIndex.get(sourceEvent.legacyGroupId) ?? [],
      canonicalOwnerId,
      coreProofState,
    });

    referenceResults.account.push(account);
    referenceResults.asset.push(asset);
    referenceResults.group.push(group);
    if ([account, asset, group].some(({ status }) => status === "block")) {
      action = "block";
    }

    const eventState = {
      sourceEvent,
      databaseEvent,
      action,
      ownerConflict:
        databaseEvent?.canonicalOwnerUserId !== null &&
        databaseEvent?.canonicalOwnerUserId !== undefined &&
        databaseEvent.canonicalOwnerUserId !== canonicalOwnerId,
    };
    eventRows.push(eventState);
    if ((sourceIndex.get(sourceEvent.legacyBase44Id)?.length ?? 0) === 1) {
      actionBySourceIdentity.set(sourceEvent.legacyBase44Id, eventState);
    }
  }

  const correctionCycleNodes = findCorrectionCycleNodes(sourceIndex);
  let correctionResults = [];
  for (let pass = 0; pass <= eventRows.length; pass += 1) {
    correctionResults = eventRows.map((eventState) =>
      evaluateCorrectionReference({
        eventState,
        sourceIndex,
        databaseEventIndex,
        actionBySourceIdentity,
        correctionCycleNodes,
        canonicalOwnerId,
      }),
    );
    let changed = false;
    correctionResults.forEach((correction, index) => {
      if (
        correction.status === "block" &&
        eventRows[index].action !== "block"
      ) {
        eventRows[index].action = "block";
        changed = true;
      }
    });
    if (!changed) break;
  }
  referenceResults.correction.push(...correctionResults);

  const actions = summarizeCanonicalOwnerActions(
    eventRows.map(({ action }) => action),
  );
  const reasonCounts = summarizeStrings([
    ...globalReasons,
    ...eventRows.map(eventActionReason),
    ...Object.values(referenceResults).flatMap((results) =>
      results.map(({ reason }) => reason),
    ),
  ]);
  const references = Object.freeze(
    Object.fromEntries(
      REFERENCE_KINDS.map((kind) => [
        kind,
        summarizeReferenceStatuses(referenceResults[kind]),
      ]),
    ),
  );
  const result =
    actions.block === 0 && globalReasons.length === 0 ? "planned" : "blocked";

  return Object.freeze({
    operation: "base44_event_canonical_owner",
    phase: "1E-C1",
    mode: "shadow",
    source: "migration_cli",
    result,
    actualWriteAllowed: false,
    canonicalOwnerWriteEnabled:
      ownerPreparation.context?.tenantWriteContext.writesCanonicalOwner ===
      true,
    databaseSideEffects: false,
    candidateCounts: Object.freeze({
      sourceEvents: sourceEvents.length,
      databaseEvents: state.events.length,
      accounts: state.accounts.length,
      assets: state.assets.length,
      groups: state.groups.length,
    }),
    actions,
    references,
    reasonCounts,
    coreProof: Object.freeze({
      result: coreProofState.result,
      fresh: coreProofState.fresh,
      accounts: coreProofState.accountCodes.size,
      assetGroups: coreProofState.groupLegacyIds.size,
      assets: coreProofState.assetLegacyIds.size,
    }),
    plannedCanonicalAssignments: actions.insert + actions.update,
    fingerprints: Object.freeze({
      owner: shadowFingerprint(canonicalOwnerId),
      source: shadowFingerprint(sourceEvents),
      databaseState: shadowFingerprint(state),
      coreProof: shadowFingerprint({
        result: coreProofState.result,
        fresh: coreProofState.fresh,
        accountCodes: [...coreProofState.accountCodes].sort(),
        assetLegacyIds: [...coreProofState.assetLegacyIds].sort(),
        groupLegacyIds: [...coreProofState.groupLegacyIds].sort(),
      }),
    }),
  });
}

function evaluateParentReference({
  kind,
  reference,
  databaseEvent,
  eventLinkField,
  candidates,
  canonicalOwnerId,
  coreProofState,
}) {
  const linkedId = databaseEvent?.[eventLinkField] ?? null;
  if (reference === null) {
    return linkedId === null
      ? referenceResult("not_applicable", `${kind}_source_reference_absent`)
      : referenceResult("block", `${kind}_unexpected_resolved_reference`);
  }
  if (candidates.length === 0) {
    return linkedId === null
      ? referenceResult(
          "legacy_only_reference",
          `${kind}_database_parent_missing`,
        )
      : referenceResult("block", `${kind}_resolved_relation_mismatch`);
  }
  if (candidates.length > 1) {
    return referenceResult("block", `${kind}_database_parent_ambiguous`);
  }

  const candidate = candidates[0];
  if (databaseEvent !== null && linkedId !== candidate.id) {
    return referenceResult("block", `${kind}_resolved_relation_mismatch`);
  }
  if (candidate.canonicalOwnerUserId === canonicalOwnerId) {
    return referenceResult("compatible", `${kind}_owner_matches`);
  }
  if (candidate.canonicalOwnerUserId !== null) {
    return referenceResult("block", `${kind}_foreign_owner`);
  }
  if (hasFreshCoreProof(coreProofState, kind, reference)) {
    return referenceResult(
      "compatible_planned",
      `${kind}_owner_covered_by_fresh_core_shadow`,
    );
  }
  return referenceResult(
    "block",
    `${kind}_resolved_parent_without_fresh_core_proof`,
  );
}

function evaluateCorrectionReference({
  eventState,
  sourceIndex,
  databaseEventIndex,
  actionBySourceIdentity,
  correctionCycleNodes,
  canonicalOwnerId,
}) {
  const sourceEvent = eventState.sourceEvent;
  const reference = sourceEvent.legacyCorrectsEventId;
  const linkedId = eventState.databaseEvent?.correctsEventId ?? null;
  if (reference === null) {
    return linkedId === null
      ? referenceResult("not_applicable", "correction_source_reference_absent")
      : referenceResult(
          "block",
          "correction_unexpected_resolved_reference",
        );
  }
  if (reference === sourceEvent.legacyBase44Id) {
    return referenceResult("block", "correction_self_reference");
  }
  if (correctionCycleNodes.has(sourceEvent.legacyBase44Id)) {
    return referenceResult("block", "correction_cycle");
  }

  const sourceTargets = sourceIndex.get(reference) ?? [];
  const databaseTargets = databaseEventIndex.get(reference) ?? [];
  if (sourceTargets.length > 1 || databaseTargets.length > 1) {
    return referenceResult("block", "correction_target_ambiguous");
  }
  const databaseTarget =
    databaseTargets.length === 1 ? databaseTargets[0] : null;
  if (
    linkedId !== null &&
    (databaseTarget === null || linkedId !== databaseTarget.id)
  ) {
    return referenceResult("block", "correction_resolved_relation_mismatch");
  }

  if (sourceTargets.length === 1) {
    const targetState = actionBySourceIdentity.get(reference);
    if (!targetState || targetState.action === "block") {
      return referenceResult("block", "correction_same_batch_target_blocked");
    }
    return referenceResult(
      "compatible_planned",
      "correction_same_batch_owner_planned",
    );
  }

  if (databaseTarget === null) {
    return referenceResult(
      "legacy_only_reference",
      "unresolved_correction_reference",
    );
  }
  if (databaseTarget.canonicalOwnerUserId === canonicalOwnerId) {
    return referenceResult("compatible", "correction_target_owner_matches");
  }
  if (databaseTarget.canonicalOwnerUserId === null) {
    return referenceResult(
      "block",
      "correction_resolved_target_owner_unproven",
    );
  }
  return referenceResult("block", "correction_foreign_owner");
}

function normalizeCoreProof(coreProof) {
  const accountCodes = new Set(coreProof?.accountCodes ?? []);
  const assetLegacyIds = new Set(coreProof?.assetLegacyIds ?? []);
  const groupLegacyIds = new Set(coreProof?.groupLegacyIds ?? []);
  const fresh =
    coreProof?.result === "planned" &&
    coreProof?.actualWriteAllowed === false &&
    coreProof?.canonicalOwnerWriteEnabled === false &&
    coreProof?.databaseSideEffects === false;

  return {
    result: coreProof?.result ?? "unavailable",
    fresh,
    accountCodes,
    assetLegacyIds,
    groupLegacyIds,
  };
}

function hasFreshCoreProof(coreProofState, kind, reference) {
  if (!coreProofState.fresh) return false;
  if (kind === "account") return coreProofState.accountCodes.has(reference);
  if (kind === "asset") return coreProofState.assetLegacyIds.has(reference);
  if (kind === "group") return coreProofState.groupLegacyIds.has(reference);
  return false;
}

function eventActionReason({ action, ownerConflict }) {
  if (action === "insert") return "event_candidate_absent";
  if (action === "update") return "event_canonical_owner_missing";
  if (action === "skip") return "event_canonical_owner_matches";
  return ownerConflict
    ? "event_canonical_owner_conflict"
    : "event_contract_blocked";
}

function findCorrectionCycleNodes(sourceIndex) {
  const nodes = new Set();
  for (const [start, rows] of sourceIndex) {
    if (rows.length !== 1) continue;
    const path = [];
    const position = new Map();
    let current = start;

    while (current !== null) {
      if (position.has(current)) {
        for (const node of path.slice(position.get(current))) nodes.add(node);
        break;
      }
      const currentRows = sourceIndex.get(current) ?? [];
      if (currentRows.length !== 1) break;
      position.set(current, path.length);
      path.push(current);
      const next = currentRows[0].legacyCorrectsEventId;
      current = next !== null && sourceIndex.has(next) ? next : null;
    }
  }
  return nodes;
}

function referenceResult(status, reason) {
  return Object.freeze({ status, reason });
}

function summarizeReferenceStatuses(results) {
  const counts = Object.fromEntries(
    REFERENCE_STATUSES.map((status) => [status, 0]),
  );
  for (const { status } of results) counts[status] += 1;
  return Object.freeze(counts);
}

function summarizeStrings(values) {
  const counts = new Map();
  for (const value of values.filter(Boolean)) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.freeze(
    Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
  );
}

function indexBy(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const value = row[key];
    if (value === null || value === undefined) continue;
    const matches = index.get(value) ?? [];
    matches.push(row);
    index.set(value, matches);
  }
  return index;
}

function duplicateKeyCount(index) {
  return [...index.values()].filter((rows) => rows.length > 1).length;
}

function assertPlanInputs(sourceEvents, state) {
  if (!Array.isArray(sourceEvents)) {
    throw new EventImportArgumentError("invalid_event_source_state");
  }
  for (const key of ["events", "accounts", "assets", "groups"]) {
    if (!Array.isArray(state?.[key])) {
      throw new EventImportArgumentError("invalid_event_database_state");
    }
  }
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function requiredString(value, code) {
  const normalized = optionalString(value);
  if (normalized === null) throw new EventImportArgumentError(code);
  return normalized;
}

function requiredBase44Id(value, code) {
  const normalized = requiredString(value, code);
  if (!BASE44_ID_PATTERN.test(normalized)) {
    throw new EventImportArgumentError(code);
  }
  return normalized.toLowerCase();
}

function optionalBase44Id(value, code) {
  const normalized = optionalString(value);
  if (normalized === null) return null;
  if (!BASE44_ID_PATTERN.test(normalized)) {
    throw new EventImportArgumentError(code);
  }
  return normalized.toLowerCase();
}

function requiredDate(value) {
  const normalized = requiredString(value, "missing_event_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new EventImportArgumentError("invalid_event_date");
  }
  return normalized;
}
