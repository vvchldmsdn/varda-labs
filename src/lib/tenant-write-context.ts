export type TenantWriteMode = "shadow" | "active";

export type TenantWriteSource =
  | "session"
  | "migration_cli"
  | "machine_job";

export type TenantWriteTargetClassification =
  | "user_owned"
  | "shared_reference"
  | "admin_system";

export type AppUserStatus = "provisioning" | "active" | "disabled";

export type UntrustedOwnerInputLocation =
  | "url"
  | "query"
  | "body"
  | "form"
  | "header";

export type TenantWriteContext = Readonly<{
  mode: TenantWriteMode;
  source: TenantWriteSource;
  targetClassification: TenantWriteTargetClassification;
  canonicalOwnerUserId: string | null;
  canonicalOwnerStatus: AppUserStatus | null;
  ownerVerified: boolean;
  writesCanonicalOwner: boolean;
}>;

export type TenantWriteOperation =
  | "insert"
  | "update"
  | "reference"
  | "delete";

export type TenantWriteRejection =
  | "untrusted_owner_input"
  | "owner_forbidden_for_target"
  | "invalid_canonical_owner"
  | "unverified_canonical_owner"
  | "missing_canonical_owner"
  | "missing_owner_status"
  | "owner_status_not_allowed"
  | "provisioning_owner_not_approved"
  | "cross_owner_existing_row"
  | "cross_owner_reference"
  | "unowned_reference"
  | "unowned_delete_target"
  | "snapshot_owner_integrity"
  | "snapshot_context_required"
  | "invalid_snapshot_identity";

type PrepareTenantWriteContextInput = Readonly<{
  mode: TenantWriteMode;
  source: TenantWriteSource;
  targetClassification: TenantWriteTargetClassification;
  canonicalOwnerUserId?: string | null;
  canonicalOwnerStatus?: AppUserStatus | null;
  canonicalOwnerVerified?: boolean;
  provisioningOwnerApproved?: boolean;
  untrustedOwnerInputLocations?: readonly UntrustedOwnerInputLocation[];
}>;

type EvaluateTenantWriteScopeInput = Readonly<{
  context: TenantWriteContext;
  operation: TenantWriteOperation;
  existingOwnerUserId?: string | null;
  referencedOwnerUserIds?: readonly (string | null)[];
}>;

export type TenantWriteScopeDecision = Readonly<{
  allowed: boolean;
  rejection: TenantWriteRejection | null;
}>;

export class TenantWritePolicyError extends Error {
  readonly code: TenantWriteRejection;

  constructor(code: TenantWriteRejection) {
    super(`Tenant write rejected: ${code}`);
    this.name = "TenantWritePolicyError";
    this.code = code;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function prepareTenantWriteContext(
  input: PrepareTenantWriteContextInput,
): TenantWriteContext {
  if ((input.untrustedOwnerInputLocations?.length ?? 0) > 0) {
    throw new TenantWritePolicyError("untrusted_owner_input");
  }

  const canonicalOwnerUserId = normalizeOptionalText(
    input.canonicalOwnerUserId,
  );
  const ownerVerified = input.canonicalOwnerVerified === true;

  if (input.targetClassification !== "user_owned") {
    if (canonicalOwnerUserId !== null || ownerVerified) {
      throw new TenantWritePolicyError("owner_forbidden_for_target");
    }

    return Object.freeze({
      mode: input.mode,
      source: input.source,
      targetClassification: input.targetClassification,
      canonicalOwnerUserId: null,
      canonicalOwnerStatus: null,
      ownerVerified: false,
      writesCanonicalOwner: false,
    });
  }

  if (
    canonicalOwnerUserId !== null &&
    !UUID_PATTERN.test(canonicalOwnerUserId)
  ) {
    throw new TenantWritePolicyError("invalid_canonical_owner");
  }

  if (canonicalOwnerUserId !== null && !ownerVerified) {
    throw new TenantWritePolicyError("unverified_canonical_owner");
  }

  const canonicalOwnerStatus = input.canonicalOwnerStatus ?? null;
  if (
    canonicalOwnerStatus !== null &&
    !["provisioning", "active", "disabled"].includes(canonicalOwnerStatus)
  ) {
    throw new TenantWritePolicyError("owner_status_not_allowed");
  }
  if (canonicalOwnerUserId !== null && canonicalOwnerStatus === null) {
    throw new TenantWritePolicyError("missing_owner_status");
  }

  if (
    canonicalOwnerUserId === null &&
    (canonicalOwnerStatus !== null || input.provisioningOwnerApproved === true)
  ) {
    throw new TenantWritePolicyError("missing_canonical_owner");
  }

  if (canonicalOwnerStatus === "disabled") {
    throw new TenantWritePolicyError("owner_status_not_allowed");
  }

  if (
    canonicalOwnerStatus === "provisioning" &&
    input.source !== "migration_cli"
  ) {
    throw new TenantWritePolicyError("owner_status_not_allowed");
  }

  if (
    canonicalOwnerStatus === "provisioning" &&
    input.provisioningOwnerApproved !== true
  ) {
    throw new TenantWritePolicyError("provisioning_owner_not_approved");
  }

  if (input.mode === "active" && canonicalOwnerUserId === null) {
    throw new TenantWritePolicyError("missing_canonical_owner");
  }

  return Object.freeze({
    mode: input.mode,
    source: input.source,
    targetClassification: input.targetClassification,
    canonicalOwnerUserId,
    canonicalOwnerStatus,
    ownerVerified,
    writesCanonicalOwner:
      input.mode === "active" && canonicalOwnerUserId !== null,
  });
}

export function canonicalOwnerAssignment(
  context: TenantWriteContext,
): Readonly<Partial<{ canonicalOwnerUserId: string }>> {
  if (!context.writesCanonicalOwner || context.canonicalOwnerUserId === null) {
    return Object.freeze({});
  }

  return Object.freeze({
    canonicalOwnerUserId: context.canonicalOwnerUserId,
  });
}

export function evaluateTenantWriteScope(
  input: EvaluateTenantWriteScopeInput,
): TenantWriteScopeDecision {
  const { context } = input;

  if (
    context.mode === "shadow" ||
    context.targetClassification !== "user_owned"
  ) {
    return allowedDecision();
  }

  const ownerUserId = context.canonicalOwnerUserId;
  if (ownerUserId === null || !context.ownerVerified) {
    return rejectedDecision("missing_canonical_owner");
  }

  const existingOwnerUserId = normalizeOptionalText(
    input.existingOwnerUserId,
  );

  if (
    existingOwnerUserId !== null &&
    existingOwnerUserId !== ownerUserId
  ) {
    return rejectedDecision("cross_owner_existing_row");
  }

  if (input.operation === "delete" && existingOwnerUserId === null) {
    return rejectedDecision("unowned_delete_target");
  }

  for (const referencedOwner of input.referencedOwnerUserIds ?? []) {
    const normalizedReference = normalizeOptionalText(referencedOwner);
    if (normalizedReference === null) {
      return rejectedDecision("unowned_reference");
    }
    if (normalizedReference !== ownerUserId) {
      return rejectedDecision("cross_owner_reference");
    }
  }

  return allowedDecision();
}

export function assertActiveTenantWriteAllowed(
  input: EvaluateTenantWriteScopeInput,
): void {
  const decision = evaluateTenantWriteScope(input);
  if (!decision.allowed && decision.rejection !== null) {
    throw new TenantWritePolicyError(decision.rejection);
  }
}

type PrepareMigrationOwnerContextInput = Readonly<{
  mode: TenantWriteMode;
  legacyOwnerUserId?: string | null;
  canonicalOwnerUserId?: string | null;
  canonicalOwnerStatus?: AppUserStatus | null;
  canonicalOwnerVerified?: boolean;
  provisioningOwnerApproved?: boolean;
}>;

export type MigrationOwnerContext = Readonly<{
  legacyOwnerUserId: string | null;
  tenantWriteContext: TenantWriteContext;
}>;

export function prepareMigrationOwnerContext(
  input: PrepareMigrationOwnerContextInput,
): MigrationOwnerContext {
  return Object.freeze({
    legacyOwnerUserId: normalizeOptionalText(input.legacyOwnerUserId),
    tenantWriteContext: prepareTenantWriteContext({
      mode: input.mode,
      source: "migration_cli",
      targetClassification: "user_owned",
      canonicalOwnerUserId: input.canonicalOwnerUserId,
      canonicalOwnerStatus: input.canonicalOwnerStatus,
      canonicalOwnerVerified: input.canonicalOwnerVerified,
      provisioningOwnerApproved: input.provisioningOwnerApproved,
    }),
  });
}

export type SnapshotWriteIdentity = Readonly<{
  canonicalOwnerUserId: string;
  snapshotDate: string;
  account: string;
}>;

type PrepareSnapshotWriteScopeInput = Readonly<{
  context: TenantWriteContext;
  snapshotDate: string;
  account: string;
  observedOwnerUserIds: readonly (string | null)[];
  legacyOnlyPositionCount: number;
}>;

export type SnapshotWriteScope = Readonly<{
  identity: SnapshotWriteIdentity;
  legacyOnlyPositionCount: number;
}>;

export function prepareSnapshotWriteScope(
  input: PrepareSnapshotWriteScopeInput,
): SnapshotWriteScope {
  const { context } = input;

  if (
    context.mode !== "active" ||
    context.targetClassification !== "user_owned" ||
    context.canonicalOwnerUserId === null ||
    !context.ownerVerified
  ) {
    throw new TenantWritePolicyError("snapshot_context_required");
  }

  if (
    !DATE_KEY_PATTERN.test(input.snapshotDate) ||
    input.account.trim().length === 0 ||
    !Number.isSafeInteger(input.legacyOnlyPositionCount) ||
    input.legacyOnlyPositionCount < 0
  ) {
    throw new TenantWritePolicyError("invalid_snapshot_identity");
  }

  if (
    input.observedOwnerUserIds.some(
      (ownerUserId) =>
        normalizeOptionalText(ownerUserId) !== context.canonicalOwnerUserId,
    )
  ) {
    throw new TenantWritePolicyError("snapshot_owner_integrity");
  }

  return Object.freeze({
    identity: Object.freeze({
      canonicalOwnerUserId: context.canonicalOwnerUserId,
      snapshotDate: input.snapshotDate,
      account: input.account.trim(),
    }),
    legacyOnlyPositionCount: input.legacyOnlyPositionCount,
  });
}

function normalizeOptionalText(value: string | null | undefined) {
  if (value === undefined || value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function allowedDecision(): TenantWriteScopeDecision {
  return Object.freeze({ allowed: true, rejection: null });
}

function rejectedDecision(
  rejection: TenantWriteRejection,
): TenantWriteScopeDecision {
  return Object.freeze({ allowed: false, rejection });
}
