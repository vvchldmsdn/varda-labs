import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REQUIRED_WRITER_IDS = [
  "admin_daily_snapshot",
  "base44_nonportfolio_asset_cleanup",
  "entity_accounts_api",
  "entity_asset_group_members_api",
  "entity_asset_groups_api",
  "entity_assets_api",
];

const CANONICAL_OWNER_PATTERN =
  /canonicalOwnerUserId|canonical_owner_user_id/;
const CANONICAL_OWNER_DML_PATTERN =
  /(?:\.values|\.set)\s*\(\s*\{[\s\S]{0,2000}canonicalOwnerUserId\s*:|(?:insert\s+into|update\s+)[\s\S]{0,2000}canonical_owner_user_id/i;
const SINGLETON_OWNER_FALLBACK_PATTERN =
  /(?:app_users|appUsers)[\s\S]{0,300}(?:limit\s*(?:\(\s*1\s*\)|1)|findFirst)|(?:limit\s*(?:\(\s*1\s*\)|1)|findFirst)[\s\S]{0,300}(?:app_users|appUsers)/i;
const LEGACY_OWNER_INFERENCE_PATTERN =
  /(?:legacyOwnerUserId|legacy_owner_user_id|ownerUserId|owner_user_id|createdById|created_by_id)[\s\S]{0,300}(?:canonicalOwnerUserId|canonical_owner_user_id)\s*[=:]|(?:canonicalOwnerUserId|canonical_owner_user_id)\s*[=:][\s\S]{0,300}(?:legacyOwnerUserId|legacy_owner_user_id|ownerUserId|owner_user_id|createdById|created_by_id)/i;
const F0_POLICY_IMPORT_PATTERN = /runtime-writer-convergence/;

export function auditRuntimeWriterConvergence({
  root,
  writerRegistry,
  freezeMatrix,
}) {
  const findings = [];
  const registryById = new Map(
    writerRegistry.map((definition) => [definition.id, definition]),
  );
  const matrixIds = freezeMatrix.map(({ writerId }) => writerId).sort();

  if (!sameValues(matrixIds, REQUIRED_WRITER_IDS)) {
    findings.push("runtime_writer_set_mismatch");
  }
  if (new Set(matrixIds).size !== matrixIds.length) {
    findings.push("duplicate_runtime_writer_definition");
  }

  const inspectedPaths = new Set();
  let canonicalOwnerReferences = 0;
  let canonicalOwnerDmlMatches = 0;
  let singletonOwnerFallbackMatches = 0;
  let legacyOwnerInferenceMatches = 0;
  let productionPolicyImports = 0;

  for (const definition of freezeMatrix) {
    const writer = registryById.get(definition.writerId);
    if (!writer) {
      findings.push(`unregistered_writer:${definition.writerId}`);
      continue;
    }

    if (writer.authorization !== definition.currentAuthorization) {
      findings.push(`authorization_mismatch:${definition.writerId}`);
    }
    if (
      definition.canonicalOwnerDmlAllowed !== false ||
      definition.singletonOwnerFallbackAllowed !== false ||
      definition.legacyOwnerInferenceAllowed !== false ||
      definition.productionContextIntegration !== "not_connected"
    ) {
      findings.push(`unsafe_freeze_policy:${definition.writerId}`);
    }

    for (const path of [
      ...writer.implementationPaths,
      ...definition.boundaryPaths,
    ]) {
      if (inspectedPaths.has(path)) continue;
      inspectedPaths.add(path);

      const absolutePath = join(root, path);
      if (!existsSync(absolutePath)) {
        findings.push(`missing_source:${path}`);
        continue;
      }

      const source = readFileSync(absolutePath, "utf8");
      if (CANONICAL_OWNER_PATTERN.test(source)) canonicalOwnerReferences += 1;
      if (CANONICAL_OWNER_DML_PATTERN.test(source)) canonicalOwnerDmlMatches += 1;
      if (SINGLETON_OWNER_FALLBACK_PATTERN.test(source)) {
        singletonOwnerFallbackMatches += 1;
      }
      if (LEGACY_OWNER_INFERENCE_PATTERN.test(source)) {
        legacyOwnerInferenceMatches += 1;
      }
      if (F0_POLICY_IMPORT_PATTERN.test(source)) productionPolicyImports += 1;
    }
  }

  if (canonicalOwnerReferences !== 0) findings.push("canonical_owner_runtime_reference");
  if (canonicalOwnerDmlMatches !== 0) findings.push("canonical_owner_dml");
  if (singletonOwnerFallbackMatches !== 0) findings.push("singleton_owner_fallback");
  if (legacyOwnerInferenceMatches !== 0) findings.push("legacy_owner_inference");
  if (productionPolicyImports !== 0) findings.push("production_policy_integration");

  const cleanupSource = readFileSync(
    join(root, "scripts/remove-base44-nonportfolio-assets.mjs"),
    "utf8",
  );
  const cleanupGuardsIntact = [
    "candidates.length !== 2",
    "!setsEqual(actual, expected)",
    "referenceCount !== 0",
    "if (!write)",
    "argv[0] === \"--write\"",
  ].every((needle) => cleanupSource.includes(needle));
  if (!cleanupGuardsIntact) findings.push("cleanup_guard_drift");

  return {
    audit: "phase1f0_runtime_writer_convergence",
    status: findings.length === 0 ? "passed" : "failed",
    writerKinds: new Set(freezeMatrix.map(({ writerKind }) => writerKind)).size,
    writers: freezeMatrix.length,
    inspectedSourceFiles: inspectedPaths.size,
    findings,
    evidence: {
      canonicalOwnerReferences,
      canonicalOwnerDmlMatches,
      singletonOwnerFallbackMatches,
      legacyOwnerInferenceMatches,
      productionPolicyImports,
      cleanupGuardsIntact,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
    },
    freezeMatrix,
  };
}

function sameValues(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === [...right].sort()[index])
  );
}
