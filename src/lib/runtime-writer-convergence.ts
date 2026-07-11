import type {
  TenantWriteContext,
  UntrustedOwnerInputLocation,
} from "@/lib/tenant-write-context";

export type RuntimeWriterKind =
  | "legacy_destructive_cleanup"
  | "compatibility_entity_api"
  | "machine_snapshot";

export type RuntimeCanonicalOwnerSource =
  | "not_applicable_legacy_cleanup"
  | "future_active_session_context"
  | "future_explicit_machine_job_target";

export type RuntimeWriterActivationStatus =
  | "legacy_cleanup_future_invocation_frozen"
  | "frozen_until_active_server_side_tenant_context";

export type RuntimeWriterFreezeDefinition = Readonly<{
  writerId: string;
  writerKind: RuntimeWriterKind;
  currentAuthorization: "migration_cli" | "machine_admin";
  canonicalOwnerSource: RuntimeCanonicalOwnerSource;
  activationStatus: RuntimeWriterActivationStatus;
  freezeCondition: string;
  unblockPrerequisite: string;
  boundaryPaths: readonly string[];
  canonicalOwnerDmlAllowed: false;
  singletonOwnerFallbackAllowed: false;
  legacyOwnerInferenceAllowed: false;
  productionContextIntegration: "not_connected";
}>;

const ENTITY_API_FREEZE = {
  writerKind: "compatibility_entity_api",
  currentAuthorization: "machine_admin",
  canonicalOwnerSource: "future_active_session_context",
  activationStatus: "frozen_until_active_server_side_tenant_context",
  freezeCondition: "no_active_session_or_owner_aware_repository",
  unblockPrerequisite:
    "identity_link_active_user_session_and_owner_aware_repository",
  canonicalOwnerDmlAllowed: false,
  singletonOwnerFallbackAllowed: false,
  legacyOwnerInferenceAllowed: false,
  productionContextIntegration: "not_connected",
} as const;

export const RUNTIME_WRITER_FREEZE_MATRIX = [
  {
    writerId: "base44_nonportfolio_asset_cleanup",
    writerKind: "legacy_destructive_cleanup",
    currentAuthorization: "migration_cli",
    canonicalOwnerSource: "not_applicable_legacy_cleanup",
    activationStatus: "legacy_cleanup_future_invocation_frozen",
    freezeCondition: "approved_two_row_cleanup_must_not_be_reopened",
    unblockPrerequisite: "separately_approved_destructive_cleanup_phase",
    boundaryPaths: ["scripts/remove-base44-nonportfolio-assets.mjs"],
    canonicalOwnerDmlAllowed: false,
    singletonOwnerFallbackAllowed: false,
    legacyOwnerInferenceAllowed: false,
    productionContextIntegration: "not_connected",
  },
  {
    writerId: "entity_accounts_api",
    ...ENTITY_API_FREEZE,
    boundaryPaths: [
      "src/app/api/entities/accounts/route.ts",
      "src/app/api/entities/accounts/[id]/route.ts",
    ],
  },
  {
    writerId: "entity_assets_api",
    ...ENTITY_API_FREEZE,
    boundaryPaths: [
      "src/app/api/entities/assets/route.ts",
      "src/app/api/entities/assets/[id]/route.ts",
    ],
  },
  {
    writerId: "entity_asset_groups_api",
    ...ENTITY_API_FREEZE,
    boundaryPaths: [
      "src/app/api/entities/asset-groups/route.ts",
      "src/app/api/entities/asset-groups/[id]/route.ts",
    ],
  },
  {
    writerId: "entity_asset_group_members_api",
    ...ENTITY_API_FREEZE,
    boundaryPaths: [
      "src/app/api/entities/asset-group-members/route.ts",
      "src/app/api/entities/asset-group-members/[id]/route.ts",
    ],
  },
  {
    writerId: "admin_daily_snapshot",
    writerKind: "machine_snapshot",
    currentAuthorization: "machine_admin",
    canonicalOwnerSource: "future_explicit_machine_job_target",
    activationStatus: "frozen_until_active_server_side_tenant_context",
    freezeCondition: "machine_secret_without_explicit_verified_user_target",
    unblockPrerequisite:
      "active_user_trusted_machine_target_and_owner_scoped_snapshot_repository",
    boundaryPaths: [
      "src/app/api/admin/snapshots/daily/route.ts",
      "src/lib/snapshots/daily.ts",
    ],
    canonicalOwnerDmlAllowed: false,
    singletonOwnerFallbackAllowed: false,
    legacyOwnerInferenceAllowed: false,
    productionContextIntegration: "not_connected",
  },
] as const satisfies readonly RuntimeWriterFreezeDefinition[];

export const FUTURE_SNAPSHOT_OWNER_CONTRACT = Object.freeze({
  readTables: Object.freeze([
    "assets",
    "accounts",
    "asset_groups",
    "asset_group_members",
    "settings",
    "event_ledger_entries",
  ] as const),
  writeTables: Object.freeze([
    "daily_position_snapshots",
    "daily_portfolio_snapshots",
  ] as const),
  namedAccountOutputs: Object.freeze(["brokerage", "isa", "irp"] as const),
  derivedAccountOutputs: Object.freeze(["all"] as const),
  ownerCardinality: "exactly_one_active_owner",
} as const);

type SnapshotReadTable =
  (typeof FUTURE_SNAPSHOT_OWNER_CONTRACT.readTables)[number];

export type FutureRuntimeWriterDecision = Readonly<{
  eligibleForFutureActivation: boolean;
  reason:
    | "future_contract_satisfied"
    | "writer_not_in_f0_scope"
    | "legacy_cleanup_frozen"
    | "untrusted_owner_input"
    | "active_session_context_required"
    | "active_machine_context_required"
    | "machine_authorization_required"
    | "explicit_machine_job_target_required";
  productionContextConnected: false;
}>;

type EvaluateFutureRuntimeWriterContextInput = Readonly<{
  writerId: string;
  tenantContext?: TenantWriteContext | null;
  machineAuthorizationVerified?: boolean;
  explicitMachineJobTargetVerified?: boolean;
  untrustedOwnerInputLocations?: readonly UntrustedOwnerInputLocation[];
}>;

export class RuntimeWriterConvergenceError extends Error {
  readonly code: FutureRuntimeWriterDecision["reason"] | "snapshot_owner_integrity";

  constructor(
    code: FutureRuntimeWriterDecision["reason"] | "snapshot_owner_integrity",
  ) {
    super(`Runtime writer convergence rejected: ${code}`);
    this.name = "RuntimeWriterConvergenceError";
    this.code = code;
  }
}

export function findCanonicalOwnerInputLocations(input: {
  bodyKeys?: readonly string[];
  queryKeys?: readonly string[];
  headerKeys?: readonly string[];
}): readonly UntrustedOwnerInputLocation[] {
  const locations: UntrustedOwnerInputLocation[] = [];

  if (containsCanonicalOwnerKey(input.bodyKeys)) locations.push("body");
  if (containsCanonicalOwnerKey(input.queryKeys)) locations.push("query");
  if (containsCanonicalOwnerKey(input.headerKeys)) locations.push("header");

  return Object.freeze(locations);
}

export function evaluateFutureRuntimeWriterContext(
  input: EvaluateFutureRuntimeWriterContextInput,
): FutureRuntimeWriterDecision {
  const definition = RUNTIME_WRITER_FREEZE_MATRIX.find(
    ({ writerId }) => writerId === input.writerId,
  );

  if (!definition) return rejectedDecision("writer_not_in_f0_scope");
  if ((input.untrustedOwnerInputLocations?.length ?? 0) > 0) {
    return rejectedDecision("untrusted_owner_input");
  }
  if (definition.writerKind === "legacy_destructive_cleanup") {
    return rejectedDecision("legacy_cleanup_frozen");
  }

  const context = input.tenantContext;
  const hasActiveOwner =
    context?.mode === "active" &&
    context.targetClassification === "user_owned" &&
    context.canonicalOwnerStatus === "active" &&
    context.ownerVerified &&
    context.canonicalOwnerUserId !== null;

  if (definition.writerKind === "compatibility_entity_api") {
    if (!hasActiveOwner || context?.source !== "session") {
      return rejectedDecision("active_session_context_required");
    }
    return eligibleDecision();
  }

  if (!hasActiveOwner || context?.source !== "machine_job") {
    return rejectedDecision("active_machine_context_required");
  }
  if (input.machineAuthorizationVerified !== true) {
    return rejectedDecision("machine_authorization_required");
  }
  if (input.explicitMachineJobTargetVerified !== true) {
    return rejectedDecision("explicit_machine_job_target_required");
  }

  return eligibleDecision();
}

export function prepareFutureSnapshotOwnerScope(input: Readonly<{
  tenantContext: TenantWriteContext;
  machineAuthorizationVerified: boolean;
  explicitMachineJobTargetVerified: boolean;
  observedOwnerUserIdsByTable: Readonly<
    Record<SnapshotReadTable, readonly (string | null)[]>
  >;
}>) {
  const decision = evaluateFutureRuntimeWriterContext({
    writerId: "admin_daily_snapshot",
    tenantContext: input.tenantContext,
    machineAuthorizationVerified: input.machineAuthorizationVerified,
    explicitMachineJobTargetVerified: input.explicitMachineJobTargetVerified,
  });

  if (!decision.eligibleForFutureActivation) {
    throw new RuntimeWriterConvergenceError(decision.reason);
  }

  const ownerUserId = input.tenantContext.canonicalOwnerUserId;
  const observedTables = Object.keys(input.observedOwnerUserIdsByTable).sort();
  const expectedTables = [...FUTURE_SNAPSHOT_OWNER_CONTRACT.readTables].sort();
  if (
    ownerUserId === null ||
    observedTables.length !== expectedTables.length ||
    observedTables.some((table, index) => table !== expectedTables[index]) ||
    FUTURE_SNAPSHOT_OWNER_CONTRACT.readTables.some((table) =>
      !Array.isArray(input.observedOwnerUserIdsByTable[table]) ||
      input.observedOwnerUserIdsByTable[table].some(
          (observedOwnerUserId) => observedOwnerUserId !== ownerUserId,
        ),
    )
  ) {
    throw new RuntimeWriterConvergenceError("snapshot_owner_integrity");
  }

  return Object.freeze({
    canonicalOwnerUserId: ownerUserId,
    readTables: FUTURE_SNAPSHOT_OWNER_CONTRACT.readTables,
    writeTables: FUTURE_SNAPSHOT_OWNER_CONTRACT.writeTables,
    namedAccountOutputs: FUTURE_SNAPSHOT_OWNER_CONTRACT.namedAccountOutputs,
    derivedAccountOutputs: FUTURE_SNAPSHOT_OWNER_CONTRACT.derivedAccountOutputs,
  });
}

function containsCanonicalOwnerKey(keys: readonly string[] | undefined) {
  return (keys ?? []).some((key) => {
    const normalized = key.replace(/[-_]/g, "").toLowerCase();
    return normalized === "canonicalowneruserid" ||
      normalized.endsWith("canonicalowneruserid");
  });
}

function eligibleDecision(): FutureRuntimeWriterDecision {
  return Object.freeze({
    eligibleForFutureActivation: true,
    reason: "future_contract_satisfied",
    productionContextConnected: false,
  });
}

function rejectedDecision(
  reason: Exclude<
    FutureRuntimeWriterDecision["reason"],
    "future_contract_satisfied"
  >,
): FutureRuntimeWriterDecision {
  return Object.freeze({
    eligibleForFutureActivation: false,
    reason,
    productionContextConnected: false,
  });
}
