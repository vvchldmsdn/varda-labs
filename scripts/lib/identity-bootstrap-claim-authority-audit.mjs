import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const CONTRACT_PATHS = [
  "src/lib/identity-bootstrap-claim-authority-policy.ts",
  "src/lib/identity-bootstrap-claim-authority.ts",
];
const AUDIT_PATHS = [
  "scripts/audit-identity-bootstrap-claim-authority.mjs",
  "scripts/lib/identity-bootstrap-claim-authority-audit.mjs",
];
const CONTRACT_IMPORT_PATTERN = /identity-bootstrap-claim-authority/;
const CONTRACT_IMPORT_STATEMENT_PATTERN =
  /^import[\s\S]*?from\s+["'][^"']*identity-bootstrap-claim-authority[^"']*["'];/gm;
const APPROVED_ISSUER_POLICY_IMPORT_PATHS = new Set([
  "scripts/lib/identity-bootstrap-claim-issuer.mjs",
  "scripts/lib/identity-bootstrap-claim-issuer-write.mjs",
]);
const APPROVED_ISSUER_POLICY_IMPORT =
  /from\s+["']\.\.\/\.\.\/src\/lib\/identity-bootstrap-claim-authority-policy\.ts["']/;
const ALLOWED_LOCAL_IMPORT =
  /from\s+["']\.\/identity-bootstrap-claim-authority-policy\.ts["']/;
const PURE_CONTRACT_FORBIDDEN_PATTERN =
  /@neondatabase|drizzle|DATABASE_URL|process\.env|process\.argv|\bfetch\s*\(|\bcookies\s*\(|\bheaders\s*\(|next\/server|from\s+["']react["']|\bcache\s*\(/;
const IDENTITY_DML_PATTERN =
  /(?:\.insert|\.update|\.delete)\s*\(|(?:insert\s+into|update\s+|delete\s+from)\s+["']?(?:app_users|auth_identities|identity_pairing_intents|identity_pairing_intent_events)\b/i;
const CLAIM_ENTRYPOINT_PATTERN =
  /process\.argv|process\.env|--claim|--subject|readArgument\s*\(/;

export function auditIdentityBootstrapClaimAuthority({
  root,
  writerRegistry,
}) {
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
    const imports =
      source.match(/^import[\s\S]*?from\s+["'][^"']+["'];/gm) ?? [];
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
  let approvedIssuerPolicyImports = 0;
  for (const path of productionPaths) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) continue;
    const source = readFileSync(absolutePath, "utf8");
    if (CONTRACT_IMPORT_PATTERN.test(source)) {
      const authorityImports =
        source.match(CONTRACT_IMPORT_STATEMENT_PATTERN) ?? [];
      if (
        APPROVED_ISSUER_POLICY_IMPORT_PATHS.has(path) &&
        authorityImports.length === 1 &&
        APPROVED_ISSUER_POLICY_IMPORT.test(authorityImports[0])
      ) {
        approvedIssuerPolicyImports += 1;
      } else {
        productionImports += 1;
      }
    }
  }
  if (productionImports !== 0) findings.push("production_contract_import");
  const issuerWriters = writerRegistry.filter(
    ({ id }) => id === "identity_bootstrap_claim_issuer",
  );
  const issuerWriterContractValid =
    issuerWriters.length === 1 &&
    issuerWriters[0].authorization === "migration_cli" &&
    issuerWriters[0].entrypoints.length === 1 &&
    issuerWriters[0].entrypoints[0] ===
      "scripts/issue-identity-bootstrap-claim.mjs" &&
    issuerWriters[0].targets.length === 1 &&
    issuerWriters[0].targets[0].table === "identity_pairing_intents" &&
    issuerWriters[0].targets[0].classification === "identity_system" &&
    issuerWriters[0].targets[0].operations.length === 1 &&
    issuerWriters[0].targets[0].operations[0] === "insert";
  if (!issuerWriterContractValid) {
    findings.push("claim_issuer_writer_contract_invalid");
  }

  const auditCliSource = readFileSync(join(root, AUDIT_PATHS[0]), "utf8");
  const claimEntrypoints = CLAIM_ENTRYPOINT_PATTERN.test(auditCliSource)
    ? 1
    : 0;
  if (claimEntrypoints !== 0) findings.push("claim_entrypoint");

  return {
    audit: "preissued_identity_bootstrap_claim_authority",
    status: findings.length === 0 ? "passed" : "failed",
    inspectedProductionFiles: productionPaths.size,
    findings,
    evidence: {
      pureContractViolations,
      identityDmlMatches,
      unexpectedImports,
      productionImports,
      approvedIssuerPolicyImports,
      claimIssuerWriters: issuerWriters.length,
      claimEntrypoints,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
      claimWrites: issuerWriterContractValid ? 1 : 0,
      identityWrites: 0,
      appUserStatusChanges: 0,
    },
  };
}

function failedResult(findings, inspectedProductionFiles) {
  return {
    audit: "preissued_identity_bootstrap_claim_authority",
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
