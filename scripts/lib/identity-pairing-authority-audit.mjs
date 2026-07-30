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
const CLAIM_ISSUER_IMPORT_PATTERN =
  /(?:from\s+|import\s*\(|require\s*\()\s*["'][^"']*identity-bootstrap-claim-issuer\.mjs["']/;
const CLAIM_EXTRACTION_EXPORT_PATTERN =
  /(?:export\s+(?:(?:async\s+)?function|const|let|var)\s+takeIssuedIdentityBootstrapClaim\b|export\s*\{[^}]*\btakeIssuedIdentityBootstrapClaim\b)/;

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
    claimIssuer.entrypoints.length === 0 &&
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
  if (claimIssuerConsumers.length !== 0) {
    findings.push("claim_issuer_runtime_import");
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
      issuerRuntimeEntrypoints: claimIssuer?.entrypoints.length ?? 0,
      claimExtractionExports,
      claimIssuerRuntimeImports: claimIssuerConsumers.length,
      auditIntentWrites: 0,
      appUserStatusChanges: 0,
    },
  };
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
