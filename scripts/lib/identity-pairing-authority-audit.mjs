import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const CONTRACT_PATHS = [
  "src/lib/identity-pairing-authority-policy.ts",
  "src/lib/identity-pairing-authority.ts",
];
const AUDIT_PATHS = [
  "scripts/audit-identity-pairing-authority.mjs",
  "scripts/lib/identity-pairing-authority-audit.mjs",
];
const CONTRACT_IMPORT_PATTERN = /identity-pairing-authority/;
const ALLOWED_LOCAL_IMPORT =
  /from\s+["']\.\/identity-pairing-authority-policy\.ts["']/;
const PURE_CONTRACT_FORBIDDEN_PATTERN =
  /@neondatabase|drizzle|DATABASE_URL|process\.env|process\.argv|\bfetch\s*\(|\bcookies\s*\(|\bheaders\s*\(|next\/server|from\s+["']react["']|\bcache\s*\(/;
const IDENTITY_DML_PATTERN =
  /(?:\.insert|\.update|\.delete)\s*\(|(?:insert\s+into|update\s+|delete\s+from)\s+["']?(?:app_users|auth_identities)\b/i;
const SUBJECT_ENTRYPOINT_PATTERN =
  /process\.argv|process\.env|--provider|--subject|readArgument\s*\(/;
const CLAIM_ISSUER_ID = "identity_bootstrap_claim_issuer";
const CLAIM_ISSUER_IMPLEMENTATION_PATH =
  "scripts/lib/identity-bootstrap-claim-issuer.mjs";
const CLAIM_ISSUER_MIGRATION_CLI_PATH =
  "scripts/issue-identity-bootstrap-claim.mjs";
const VERIFIED_SESSION_PRESENTATION_CORE_PATH =
  "scripts/lib/verified-session-claim-presentation.mjs";
const VERIFIED_SESSION_PRESENTATION_ADAPTER_PATH =
  "src/lib/auth/private-verified-session-claim-presentation.ts";
const VERIFIED_SESSION_CONSUME_CORE_PATH =
  "scripts/lib/verified-session-identity-consume.mjs";
const VERIFIED_SESSION_CONSUME_CAPABILITY_PATH =
  "scripts/lib/verified-session-consume-capability.mjs";
const VERIFIED_SESSION_CONSUME_ADAPTER_PATH =
  "src/lib/auth/private-verified-session-identity-consume.ts";
const IDENTITY_CONSUME_WRITER_PATH =
  "scripts/lib/identity-pairing-consume-writer.mjs";
const CLAIM_PRESENTATION_ROUTE_PATH =
  "src/app/api/identity/bootstrap-claim/present/route.ts";
const CLAIM_ISSUER_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*identity-bootstrap-claim-issuer\.mjs["']/;
const CLAIM_ISSUER_MIGRATION_CLI_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*issue-identity-bootstrap-claim\.mjs["']/;
const CLAIM_EXTRACTION_EXPORT_PATTERN =
  /(?:export\s+(?:(?:async\s+)?function|const|let|var)\s+takeIssuedIdentityBootstrapClaim\b|export\s*\{[^}]*\btakeIssuedIdentityBootstrapClaim\b)/;
const VERIFIED_SESSION_PRESENTATION_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*private-verified-session-claim-presentation(?:\.ts)?["']/;
const VERIFIED_SESSION_CONSUME_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*private-verified-session-identity-consume(?:\.ts)?["']/;
const ACCOUNT_ASSIGNMENT_WRITER_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*legacy-account-owner-assignment-writer\.mjs["']/;
const CLAIM_ISSUER_MIGRATION_CLI_FORBIDDEN_PATTERN =
  /verified-session|session-subject-binding|identity-pairing-consume|one-user-bootstrap-execution|legacy-account-owner-assignment|src\/app|next\/server|\bcookies\s*\(|\bheaders\s*\(|\bfetch\s*\(/;

export function auditIdentityPairingAuthority({ root, writerRegistry }) {
  const findings = [];
  if (CONTRACT_PATHS.some((path) => !existsSync(join(root, path)))) {
    return failedResult(["missing_contract"], 0);
  }

  const contractSources = CONTRACT_PATHS.map((path) =>
    readFileSync(join(root, path), "utf8"),
  );
  const pureContractViolations = contractSources.filter((source) =>
    PURE_CONTRACT_FORBIDDEN_PATTERN.test(source),
  ).length;
  const identityDmlMatches = contractSources.filter((source) =>
    IDENTITY_DML_PATTERN.test(source),
  ).length;
  const unexpectedImports = contractSources.filter((source) => {
    const imports = source.match(/^import[\s\S]*?from\s+["'][^"']+["'];/gm) ?? [];
    return imports.some((statement) => !ALLOWED_LOCAL_IMPORT.test(statement));
  }).length;
  if (pureContractViolations !== 0) findings.push("contract_not_pure");
  if (identityDmlMatches !== 0) findings.push("identity_dml_present");
  if (unexpectedImports !== 0) findings.push("unexpected_contract_import");

  const productionPaths = new Set(
    [...walk(join(root, "src")), ...walk(join(root, "scripts"))]
      .filter((path) => /\.(?:ts|tsx|mjs)$/.test(path))
      .map((path) => relative(root, path).replaceAll("\\", "/"))
      .filter(
        (path) =>
          !CONTRACT_PATHS.includes(path) && !AUDIT_PATHS.includes(path),
      ),
  );
  for (const writer of writerRegistry) {
    for (const path of writer.implementationPaths) productionPaths.add(path);
  }

  let productionImports = 0;
  for (const path of productionPaths) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) continue;
    if (CONTRACT_IMPORT_PATTERN.test(readFileSync(absolutePath, "utf8"))) {
      productionImports += 1;
    }
  }
  if (productionImports !== 0) findings.push("production_contract_import");

  const auditCliSource = readFileSync(join(root, AUDIT_PATHS[0]), "utf8");
  const subjectEntrypoints = SUBJECT_ENTRYPOINT_PATTERN.test(auditCliSource)
    ? 1
    : 0;
  if (subjectEntrypoints !== 0) findings.push("subject_entrypoint");

  const registeredIntentWriters = writerRegistry.filter((writer) =>
    writer.targets.some(
      (target) =>
        target.table === "identity_pairing_intents" &&
        target.operations.includes("insert"),
    ),
  );
  if (registeredIntentWriters.length !== 1) {
    findings.push("claim_issuer_writer_count_invalid");
  }
  const claimIssuer = registeredIntentWriters[0] ?? null;
  const claimIssuerBoundaryIntact =
    claimIssuer?.id === CLAIM_ISSUER_ID &&
    claimIssuer.classification === "identity_system" &&
    claimIssuer.authorization === "migration_cli" &&
    claimIssuer.entrypoints.length === 1 &&
    claimIssuer.entrypoints[0] === CLAIM_ISSUER_MIGRATION_CLI_PATH &&
    claimIssuer.implementationPaths.length === 1 &&
    claimIssuer.implementationPaths[0] ===
      CLAIM_ISSUER_IMPLEMENTATION_PATH &&
    claimIssuer.transition.activate === "single_claim_intent_insert";
  if (!claimIssuerBoundaryIntact) {
    findings.push("claim_issuer_boundary_drift");
  }
  const claimIssuerSource = readFileSync(
    join(root, CLAIM_ISSUER_IMPLEMENTATION_PATH),
    "utf8",
  );
  const claimExtractionExports = CLAIM_EXTRACTION_EXPORT_PATTERN.test(
    claimIssuerSource,
  )
    ? 1
    : 0;
  if (claimExtractionExports !== 0) {
    findings.push("claim_extraction_exported");
  }
  const claimIssuerConsumers = [...productionPaths].filter((path) => {
    if (path === CLAIM_ISSUER_IMPLEMENTATION_PATH) return false;
    const absolutePath = join(root, path);
    return (
      existsSync(absolutePath) &&
      CLAIM_ISSUER_IMPORT_PATTERN.test(
        readFileSync(absolutePath, "utf8"),
      )
    );
  });
  const claimIssuerMigrationCliConsumers =
    claimIssuerConsumers.filter(
      (path) => path === CLAIM_ISSUER_MIGRATION_CLI_PATH,
    );
  const claimIssuerRuntimeConsumers = [...productionPaths].filter((path) => {
    if (
      path === CLAIM_ISSUER_IMPLEMENTATION_PATH ||
      path === CLAIM_ISSUER_MIGRATION_CLI_PATH
    ) {
      return false;
    }
    const absolutePath = join(root, path);
    return (
      existsSync(absolutePath) &&
      importsIdentityBootstrapClaimIssuerAuthority(
        readFileSync(absolutePath, "utf8"),
      )
    );
  });
  if (claimIssuerRuntimeConsumers.length !== 0) {
    findings.push("claim_issuer_runtime_import");
  }
  const claimIssuerMigrationCliSource = readFileSync(
    join(root, CLAIM_ISSUER_MIGRATION_CLI_PATH),
    "utf8",
  );
  const claimIssuerMigrationCliBoundaryIntact =
    claimIssuerMigrationCliConsumers.length === 1 &&
    CLAIM_ISSUER_IMPORT_PATTERN.test(
      claimIssuerMigrationCliSource,
    ) &&
    /production-database-target/.test(
      claimIssuerMigrationCliSource,
    ) &&
    !CLAIM_ISSUER_MIGRATION_CLI_FORBIDDEN_PATTERN.test(
      claimIssuerMigrationCliSource,
    );
  if (!claimIssuerMigrationCliBoundaryIntact) {
    findings.push("claim_issuer_migration_cli_boundary_drift");
  }

  const verifiedSessionPresentationCore = readFileSync(
    join(root, VERIFIED_SESSION_PRESENTATION_CORE_PATH),
    "utf8",
  );
  const verifiedSessionPresentationAdapter = readFileSync(
    join(root, VERIFIED_SESSION_PRESENTATION_ADAPTER_PATH),
    "utf8",
  );
  const claimPresentationRoute = readFileSync(
    join(root, CLAIM_PRESENTATION_ROUTE_PATH),
    "utf8",
  );
  const verifiedSessionPresentationBoundaryIntact =
    verifiedSessionPresentationAdapter.startsWith(
      'import "server-only";',
    ) &&
    verifiedSessionPresentationAdapter.includes(
      "readPrivateSessionSubjectBinding",
    ) &&
    verifiedSessionPresentationAdapter.includes(
      "executeVerifiedSessionClaimPresentation",
    ) &&
    verifiedSessionPresentationAdapter.includes(
      "startOneUserBootstrapExecution",
    ) &&
    !CLAIM_ISSUER_IMPORT_PATTERN.test(
      verifiedSessionPresentationAdapter,
    ) &&
    !/identity-pairing-consume-writer/.test(
      verifiedSessionPresentationAdapter,
    ) &&
    !/(?:DATABASE_URL|process\.env|@\/db|drizzle)/.test(
      verifiedSessionPresentationCore,
    );
  if (!verifiedSessionPresentationBoundaryIntact) {
    findings.push("verified_session_presentation_boundary_drift");
  }
  const verifiedSessionPresentationConsumers = [
    ...productionPaths,
  ].filter((path) => {
    if (path === VERIFIED_SESSION_PRESENTATION_ADAPTER_PATH) {
      return false;
    }
    const absolutePath = join(root, path);
    return (
      existsSync(absolutePath) &&
      VERIFIED_SESSION_PRESENTATION_IMPORT_PATTERN.test(
        readFileSync(absolutePath, "utf8"),
      )
    );
  });
  if (verifiedSessionPresentationConsumers.length !== 0) {
    findings.push("verified_session_presentation_runtime_import");
  }
  const claimPresentationRouteEnabled =
    VERIFIED_SESSION_PRESENTATION_IMPORT_PATTERN.test(
      claimPresentationRoute,
    ) ||
    claimPresentationRoute.includes(
      "executeVerifiedSessionClaimPresentation",
    ) ||
    !claimPresentationRoute.includes(
      "createDisabledIdentityPairingClaimPresentationResponse()",
    );
  if (claimPresentationRouteEnabled) {
    findings.push("claim_presentation_route_enabled");
  }

  const identityConsumeWriter = writerRegistry.find(
    (writer) => writer.id === "identity_pairing_atomic_consume",
  );
  const identityConsumeAuthorityIntact =
    identityConsumeWriter?.classification === "identity_system" &&
    identityConsumeWriter.authorization === "server_verified_session" &&
    identityConsumeWriter.entrypoints.length === 0 &&
    identityConsumeWriter.implementationPaths.length === 1 &&
    identityConsumeWriter.implementationPaths[0] ===
      IDENTITY_CONSUME_WRITER_PATH &&
    identityConsumeWriter.transition.activate ===
      "atomic_identity_pairing_consume";
  if (!identityConsumeAuthorityIntact) {
    findings.push("identity_consume_authority_drift");
  }

  const verifiedSessionConsumeCore = readFileSync(
    join(root, VERIFIED_SESSION_CONSUME_CORE_PATH),
    "utf8",
  );
  const verifiedSessionConsumeCapability = readFileSync(
    join(root, VERIFIED_SESSION_CONSUME_CAPABILITY_PATH),
    "utf8",
  );
  const verifiedSessionConsumeAdapter = readFileSync(
    join(root, VERIFIED_SESSION_CONSUME_ADAPTER_PATH),
    "utf8",
  );
  const verifiedSessionConsumeBoundaryIntact =
    verifiedSessionConsumeAdapter.startsWith('import "server-only";') &&
    verifiedSessionConsumeAdapter.includes(
      "createPrivateSessionConsumeCapability",
    ) &&
    verifiedSessionConsumeAdapter.includes(
      "executeVerifiedSessionIdentityConsume",
    ) &&
    verifiedSessionConsumeAdapter.includes(
      "consumeIdentityPairingClaim",
    ) &&
    !CLAIM_ISSUER_IMPORT_PATTERN.test(verifiedSessionConsumeAdapter) &&
    !ACCOUNT_ASSIGNMENT_WRITER_IMPORT_PATTERN.test(
      verifiedSessionConsumeAdapter,
    ) &&
    !/(?:DATABASE_URL|@\/db|drizzle)/.test(
      verifiedSessionConsumeAdapter,
    ) &&
    !/(?:DATABASE_URL|process\.env|@\/db|drizzle|@neondatabase)/.test(
      verifiedSessionConsumeCore,
    ) &&
    !/(?:DATABASE_URL|process\.env|@\/db|drizzle|@neondatabase)/.test(
      verifiedSessionConsumeCapability,
    );
  if (!verifiedSessionConsumeBoundaryIntact) {
    findings.push("verified_session_consume_boundary_drift");
  }
  const verifiedSessionConsumeConsumers = [...productionPaths].filter(
    (path) => {
      if (path === VERIFIED_SESSION_CONSUME_ADAPTER_PATH) return false;
      const absolutePath = join(root, path);
      return (
        existsSync(absolutePath) &&
        VERIFIED_SESSION_CONSUME_IMPORT_PATTERN.test(
          readFileSync(absolutePath, "utf8"),
        )
      );
    },
  );
  if (verifiedSessionConsumeConsumers.length !== 0) {
    findings.push("verified_session_consume_runtime_import");
  }
  const identityConsumeRouteEnabled =
    VERIFIED_SESSION_CONSUME_IMPORT_PATTERN.test(
      claimPresentationRoute,
    ) ||
    claimPresentationRoute.includes(
      "executeVerifiedSessionIdentityConsume",
    );
  if (identityConsumeRouteEnabled) {
    findings.push("identity_consume_route_enabled");
  }

  const proxySource = readFileSync(join(root, "src/proxy.ts"), "utf8");
  const basicAuthBoundaryIntact = [
    "VARDA_APP_PASSWORD",
    "APP_ACCESS_PASSWORD",
    "WWW-Authenticate",
  ].every((marker) => proxySource.includes(marker));
  if (!basicAuthBoundaryIntact) findings.push("basic_auth_boundary_drift");

  return {
    audit: "phase1g1b1b_identity_pairing_authority_dry_run",
    status: findings.length === 0 ? "passed" : "failed",
    inspectedProductionFiles: productionPaths.size,
    findings,
    evidence: {
      pureContractViolations,
      identityDmlMatches,
      unexpectedImports,
      productionImports,
      subjectEntrypoints,
      basicAuthBoundaryIntact,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
      registeredIntentWriters: registeredIntentWriters.length,
      issuerRuntimeEntrypoints: 0,
      issuerMigrationCliEntrypoints:
        claimIssuer?.entrypoints.length ?? 0,
      claimExtractionExports,
      claimIssuerRuntimeImports: claimIssuerRuntimeConsumers.length,
      claimIssuerMigrationCliImports:
        claimIssuerMigrationCliConsumers.length,
      claimIssuerMigrationCliBoundaryIntact,
      verifiedSessionPresentationAdapters:
        verifiedSessionPresentationBoundaryIntact ? 1 : 0,
      verifiedSessionPresentationRuntimeImports:
        verifiedSessionPresentationConsumers.length,
      claimPresentationRouteEnabled:
        claimPresentationRouteEnabled ? 1 : 0,
      identityConsumeAuthorityIntact,
      verifiedSessionConsumeAdapters:
        verifiedSessionConsumeBoundaryIntact ? 1 : 0,
      verifiedSessionConsumeRuntimeImports:
        verifiedSessionConsumeConsumers.length,
      identityConsumeRouteEnabled:
        identityConsumeRouteEnabled ? 1 : 0,
      auditIntentWrites: 0,
      appUserStatusChanges: 0,
    },
  };
}

export function importsIdentityBootstrapClaimIssuerAuthority(source) {
  return (
    typeof source === "string" &&
    (CLAIM_ISSUER_IMPORT_PATTERN.test(source) ||
      CLAIM_ISSUER_MIGRATION_CLI_IMPORT_PATTERN.test(source))
  );
}

function failedResult(findings, inspectedProductionFiles) {
  return {
    audit: "phase1g1b1b_identity_pairing_authority_dry_run",
    status: "failed",
    inspectedProductionFiles,
    findings,
    evidence: null,
  };
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
