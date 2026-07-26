import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const CONTRACT_PATHS = [
  "src/lib/initial-identity-link-planner.ts",
  "src/lib/initial-identity-link-policy.ts",
];
const AUDIT_PATHS = [
  "scripts/audit-initial-identity-link-planner.mjs",
  "scripts/lib/initial-identity-link-planner-audit.mjs",
];
const CONTRACT_IMPORT_PATTERN = /initial-identity-link-(?:planner|policy)/;
const APPROVED_CONSUME_WRITER_PATH =
  "scripts/lib/identity-pairing-consume-writer.mjs";
const APPROVED_CONSUME_PLANNER_IMPORT =
  /from\s+["']\.\.\/\.\.\/src\/lib\/initial-identity-link-planner\.ts["']/;
const PURE_CONTRACT_FORBIDDEN_PATTERN =
  /^\s*import\s|@neondatabase|drizzle|DATABASE_URL|process\.env|process\.argv|\bfetch\s*\(|\bcookies\s*\(|\bheaders\s*\(|next\/server|from\s+["']react["']|\bcache\s*\(/m;
const IDENTITY_DML_PATTERN =
  /(?:\.insert|\.update|\.delete)\s*\(|(?:insert\s+into|update\s+|delete\s+from)\s+["']?(?:app_users|auth_identities)\b/i;
const AUTH_SDK_DEPENDENCY_PATTERN =
  /^(?:@neondatabase\/auth|@auth\/|next-auth|better-auth)/i;
const ALLOWED_PREVIEW_AUTH_SDK = "@neondatabase/auth";
const SUBJECT_CLI_PATTERN =
  /process\.argv|process\.env|--provider|--subject|readArgument\s*\(/;

export function auditInitialIdentityLinkPlanner({ root, writerRegistry }) {
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
  if (pureContractViolations !== 0) findings.push("contract_not_pure");
  if (identityDmlMatches !== 0) findings.push("identity_dml_present");

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
  let approvedConsumePlannerImports = 0;
  for (const path of productionPaths) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) continue;
    const source = readFileSync(absolutePath, "utf8");
    if (CONTRACT_IMPORT_PATTERN.test(source)) {
      if (
        path === APPROVED_CONSUME_WRITER_PATH &&
        APPROVED_CONSUME_PLANNER_IMPORT.test(source)
      ) {
        approvedConsumePlannerImports += 1;
      } else {
        productionImports += 1;
      }
    }
  }
  if (productionImports !== 0) findings.push("production_contract_import");
  if (approvedConsumePlannerImports !== 1) {
    findings.push("consume_planner_import_invalid");
  }

  const consumeWriters = writerRegistry.filter(
    ({ id }) => id === "identity_pairing_atomic_consume",
  );
  const consumeWriterContractValid =
    consumeWriters.length === 1 &&
    consumeWriters[0].authorization === "server_verified_session" &&
    consumeWriters[0].entrypoints.length === 0 &&
    consumeWriters[0].implementationPaths.length === 1 &&
    consumeWriters[0].implementationPaths[0] ===
      APPROVED_CONSUME_WRITER_PATH &&
    JSON.stringify(consumeWriters[0].targets) ===
      JSON.stringify([
        identityTarget("auth_identities", "insert"),
        identityTarget("app_users", "update"),
        identityTarget("identity_pairing_intent_events", "insert"),
      ]);
  if (!consumeWriterContractValid) {
    findings.push("consume_writer_contract_invalid");
  }

  const auditCliSource = readFileSync(join(root, AUDIT_PATHS[0]), "utf8");
  const subjectCliEntrypoints = SUBJECT_CLI_PATTERN.test(auditCliSource) ? 1 : 0;
  if (subjectCliEntrypoints !== 0) findings.push("subject_cli_entrypoint");

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencyNames = Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  });
  const authSdkDependencies = dependencyNames.filter((name) =>
    AUTH_SDK_DEPENDENCY_PATTERN.test(name),
  );
  const unexpectedAuthSdkDependencies = authSdkDependencies.filter(
    (name) => name !== ALLOWED_PREVIEW_AUTH_SDK,
  );
  if (unexpectedAuthSdkDependencies.length !== 0) {
    findings.push("unexpected_auth_sdk_installed");
  }

  const proxySource = readFileSync(join(root, "src/proxy.ts"), "utf8");
  const basicAuthBoundaryIntact = [
    "VARDA_APP_PASSWORD",
    "APP_ACCESS_PASSWORD",
    "Basic ",
    "WWW-Authenticate",
  ].every((marker) => proxySource.includes(marker));
  if (!basicAuthBoundaryIntact) findings.push("basic_auth_boundary_drift");

  return {
    audit: "phase1g1a_initial_identity_link_planner",
    status: findings.length === 0 ? "passed" : "failed",
    inspectedProductionFiles: productionPaths.size,
    findings,
    evidence: {
      pureContractViolations,
      identityDmlMatches,
      productionImports,
      approvedConsumePlannerImports,
      consumeWriters: consumeWriters.length,
      consumeRuntimeEntrypoints: consumeWriters[0]?.entrypoints.length ?? 0,
      subjectCliEntrypoints,
      authSdkDependencies: authSdkDependencies.length,
      unexpectedAuthSdkDependencies: unexpectedAuthSdkDependencies.length,
      basicAuthBoundaryIntact,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
      appUserStatusChanges: 0,
    },
  };
}

function identityTarget(table, operation) {
  return {
    table,
    classification: "identity_system",
    operations: [operation],
    ownerPolicy: "owner_forbidden",
  };
}

function failedResult(findings, inspectedProductionFiles) {
  return {
    audit: "phase1g1a_initial_identity_link_planner",
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
