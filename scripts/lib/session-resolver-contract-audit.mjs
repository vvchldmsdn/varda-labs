import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const CONTRACT_PATHS = [
  "src/lib/session-resolver-contract.ts",
  "src/lib/session-resolver-policy.ts",
];
const CONTRACT_IMPORT_PATTERN = /session-resolver-(?:contract|policy)/;
const IMPORT_FROM_PATTERN =
  /^\s*import\s+([\s\S]*?)\s+from\s+["']([^"']+)["'];?[ \t]*(?:\r?\n|$)/gm;
const PURE_CONTRACT_FORBIDDEN_PATTERN =
  /^\s*import\s|@neondatabase|drizzle|DATABASE_URL|process\.env|\bfetch\s*\(|\bcookies\s*\(|\bheaders\s*\(|next\/server|from\s+["']react["']|\bcache\s*\(/m;
const IDENTITY_DML_PATTERN =
  /(?:\.insert|\.update|\.delete)\s*\(|(?:insert\s+into|update\s+|delete\s+from)\s+["']?(?:app_users|auth_identities)\b/i;
const AUTH_SDK_DEPENDENCY_PATTERN =
  /^(?:@neondatabase\/auth|@auth\/|next-auth|better-auth)/i;

export function auditSessionResolverContract({ root, writerRegistry }) {
  const findings = [];
  const missingContracts = CONTRACT_PATHS.filter(
    (path) => !existsSync(join(root, path)),
  );
  if (missingContracts.length !== 0) {
    return failedResult(["missing_contract"], 0);
  }

  const contractSources = CONTRACT_PATHS.map((path) =>
    readFileSync(join(root, path), "utf8")
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
    walk(join(root, "src"))
      .filter((path) => /\.(?:ts|tsx)$/.test(path))
      .map((path) => relative(root, path).replaceAll("\\", "/"))
      .filter((path) => !CONTRACT_PATHS.includes(path)),
  );
  for (const writer of writerRegistry) {
    for (const path of writer.implementationPaths) productionPaths.add(path);
  }

  let productionImports = 0;
  for (const path of productionPaths) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) continue;
    const sourceWithoutTypeOnlyImports = stripTypeOnlyContractImports(
      readFileSync(absolutePath, "utf8"),
    );
    if (CONTRACT_IMPORT_PATTERN.test(sourceWithoutTypeOnlyImports)) {
      productionImports += 1;
    }
  }
  if (productionImports !== 0) findings.push("production_contract_import");

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencyNames = Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  });
  const authSdkDependencies = dependencyNames.filter((name) =>
    AUTH_SDK_DEPENDENCY_PATTERN.test(name),
  );
  if (authSdkDependencies.length !== 0) findings.push("auth_sdk_installed");

  const proxySource = readFileSync(join(root, "src/proxy.ts"), "utf8");
  const basicAuthBoundaryIntact = [
    "VARDA_APP_PASSWORD",
    "APP_ACCESS_PASSWORD",
    "Basic ",
    "WWW-Authenticate",
  ].every((marker) => proxySource.includes(marker));
  if (!basicAuthBoundaryIntact) findings.push("basic_auth_boundary_drift");

  return {
    audit: "phase1g0_session_resolver_contract",
    status: findings.length === 0 ? "passed" : "failed",
    inspectedProductionFiles: productionPaths.size,
    findings,
    evidence: {
      pureContractViolations,
      identityDmlMatches,
      productionImports,
      authSdkDependencies: authSdkDependencies.length,
      basicAuthBoundaryIntact,
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
      cacheImplementations: 0,
    },
  };
}

function stripTypeOnlyContractImports(source) {
  return source.replace(
    IMPORT_FROM_PATTERN,
    (statement, importClause, specifier) =>
      CONTRACT_IMPORT_PATTERN.test(specifier) &&
      /^type\b/.test(importClause.trim())
        ? ""
        : statement,
  );
}

function failedResult(findings, inspectedProductionFiles) {
  return {
    audit: "phase1g0_session_resolver_contract",
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
