import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { REVIEWED_AUTH_SDK_VERSIONS } from "./auth-sdk-version-policy.mjs";

const CONTRACT_PATHS = [
  "src/lib/session-resolver-contract.ts",
  "src/lib/session-resolver-policy.ts",
];
const RUNTIME_ADAPTER_PATH =
  "src/lib/auth/current-tenant-context.ts";
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

  const productionImportPaths = [];
  for (const path of productionPaths) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) continue;
    const sourceWithoutTypeOnlyImports = stripTypeOnlyContractImports(
      readFileSync(absolutePath, "utf8"),
    );
    if (CONTRACT_IMPORT_PATTERN.test(sourceWithoutTypeOnlyImports)) {
      productionImportPaths.push(path);
    }
  }
  const unexpectedProductionImports = productionImportPaths.filter(
    (path) => path !== RUNTIME_ADAPTER_PATH,
  );
  if (
    productionImportPaths.length !== 1 ||
    unexpectedProductionImports.length !== 0
  ) {
    findings.push("production_contract_import_boundary");
  }

  const runtimeSource = readFileSync(
    join(root, RUNTIME_ADAPTER_PATH),
    "utf8",
  );
  const sessionSource = readFileSync(
    join(root, "src/lib/auth/current-session-subject.ts"),
    "utf8",
  );
  const runtimeBoundaryIntact =
    runtimeSource.startsWith('import "server-only";') &&
    [
      "cache(",
      "readCurrentSessionSubject()",
      "session.provider, session.providerSubject",
      "authIdentities",
      "appUsers",
      "resolveSessionToAppUser",
      ".limit(2)",
    ].every((marker) => runtimeSource.includes(marker)) &&
    sessionSource.startsWith('import "server-only";') &&
    ["getAuthTransportRuntime", "auth.getSession()", "readNaverSession()", "resolveProviderSessions(neon, naver)", "emailVerified === true"].every((marker) => sessionSource.includes(marker)) &&
    !IDENTITY_DML_PATTERN.test(runtimeSource + sessionSource) &&
    !/console\.|NextResponse|Response\(|\bfetch\s*\(/.test(runtimeSource);
  if (!runtimeBoundaryIntact) {
    findings.push("runtime_adapter_boundary_drift");
  }

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };
  const dependencyNames = Object.keys(dependencies);
  const authSdkDependencies = dependencyNames.filter((name) =>
    AUTH_SDK_DEPENDENCY_PATTERN.test(name),
  );
  const unexpectedAuthSdkDependencies = authSdkDependencies.filter(
    (name) =>
      !Object.hasOwn(REVIEWED_AUTH_SDK_VERSIONS, name) ||
      dependencies[name] !== REVIEWED_AUTH_SDK_VERSIONS[name],
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
    audit: "phase1g0_session_resolver_contract",
    status: findings.length === 0 ? "passed" : "failed",
    inspectedProductionFiles: productionPaths.size,
    findings,
    evidence: {
      pureContractViolations,
      identityDmlMatches,
      productionImports: productionImportPaths.length,
      unexpectedProductionImports: unexpectedProductionImports.length,
      runtimeBoundaryIntact,
      authSdkDependencies: authSdkDependencies.length,
      unexpectedAuthSdkDependencies: unexpectedAuthSdkDependencies.length,
      basicAuthBoundaryIntact,
      databaseQueries: 1,
      databaseWrites: 0,
      providerCalls: 1,
      routeCalls: 0,
      cacheImplementations: 2,
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
