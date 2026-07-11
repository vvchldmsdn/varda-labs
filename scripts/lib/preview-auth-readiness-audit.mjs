import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import {
  NEON_AUTH_EVIDENCE_SNAPSHOT,
  assessPreviewAuthReadiness,
} from "../../src/lib/preview-auth-readiness-policy.ts";

const POLICY_PATH = "src/lib/preview-auth-readiness-policy.ts";
const AUTH_SDK_DEPENDENCY_PATTERN =
  /^(?:@neondatabase\/auth|@auth\/|next-auth|better-auth)/i;
const AUTH_RUNTIME_PATTERN =
  /@neondatabase\/auth|\bcreateNeonAuth\b|\bauth\.(?:handler|middleware|getSession)\s*\(/;
const MANAGED_SCHEMA_OWNERSHIP_PATTERN =
  /(?:pgSchema|schema)\s*\(\s*["']neon_auth["']/;
const PUBLIC_AUTH_ENV_PATTERN =
  /NEXT_PUBLIC_(?:STACK_|NEON_AUTH|AUTH_|[^\s"']*AUTH[^\s"']*)/;

const UNVERIFIED_ENVIRONMENT = Object.freeze({
  baseUrl: "unverified",
  cookieSecret: "unverified",
  browserAuthUrl: "unverified",
});

export function auditPreviewAuthReadiness({ root, localEnvironment }) {
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const dependencyNames = Object.keys({
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  });
  const authSdkDependencies = dependencyNames.filter((name) =>
    AUTH_SDK_DEPENDENCY_PATTERN.test(name),
  );

  const sourcePaths = walk(join(root, "src"))
    .filter((path) => /\.(?:ts|tsx)$/.test(path))
    .map((path) => relative(root, path).replaceAll("\\", "/"));
  const productionPaths = sourcePaths.filter((path) => path !== POLICY_PATH);

  const authRoutePresent = sourcePaths.some((path) =>
    path.startsWith("src/app/api/auth/"),
  );
  const authRuntimeImports = productionPaths.filter((path) =>
    AUTH_RUNTIME_PATTERN.test(readFileSync(join(root, path), "utf8")),
  ).length;
  const publicAuthEnvironmentReferences = [
    ...productionPaths,
    "next.config.ts",
  ].filter((path) => {
    const absolutePath = join(root, path);
    return (
      existsSync(absolutePath) &&
      PUBLIC_AUTH_ENV_PATTERN.test(readFileSync(absolutePath, "utf8"))
    );
  }).length;

  const proxySource = readFileSync(join(root, "src/proxy.ts"), "utf8");
  const basicAuthBoundaryIntact = [
    "VARDA_APP_PASSWORD",
    "APP_ACCESS_PASSWORD",
    "Basic ",
    "WWW-Authenticate",
  ].every((marker) => proxySource.includes(marker));

  const schemaSource = readFileSync(join(root, "src/db/schema.ts"), "utf8");
  const managedNeonAuthSchemaOwnedByDrizzle =
    MANAGED_SCHEMA_OWNERSHIP_PATTERN.test(schemaSource);

  const assessment = assessPreviewAuthReadiness({
    nextVersion: packageJson.dependencies?.next ?? "",
    authSdkInstalled: authSdkDependencies.length !== 0,
    authRoutePresent,
    authRuntimeImports,
    basicAuthBoundaryIntact,
    managedNeonAuthSchemaOwnedByDrizzle,
    publicAuthEnvironmentReferences,
    localEnvironment,
    previewEnvironment: UNVERIFIED_ENVIRONMENT,
    productionEnvironment: UNVERIFIED_ENVIRONMENT,
    productionAuthRuntime: "unverified",
    providerSubjectSource: "unresolved",
    operatorHandoff: "unresolved",
  });

  return {
    audit: "phase1g1b0_preview_auth_readiness",
    status: assessment.auditStatus,
    previewReadiness: assessment.previewDecision,
    productionDecision: assessment.productionDecision,
    fallback: assessment.fallback,
    findings: [...assessment.scopeViolations],
    blockers: [...assessment.blockers],
    evidence: {
      inspectedProductionFiles: productionPaths.length,
      nextVersion: packageJson.dependencies?.next ?? null,
      sdkEvidence: NEON_AUTH_EVIDENCE_SNAPSHOT,
      authSdkDependencies: authSdkDependencies.length,
      authRoutePresent,
      authRuntimeImports,
      basicAuthBoundaryIntact,
      managedNeonAuthSchemaOwnedByDrizzle,
      publicAuthEnvironmentReferences,
      environments: {
        local: localEnvironment,
        preview: UNVERIFIED_ENVIRONMENT,
        production: UNVERIFIED_ENVIRONMENT,
      },
      databaseQueries: 0,
      databaseWrites: 0,
      providerCalls: 0,
      routeCalls: 0,
      identityDml: 0,
      appUserStatusChanges: 0,
    },
  };
}

export function inspectLocalAuthEnvironment(root) {
  const values = readNamedEnvironmentValues(join(root, ".env.local"), [
    "NEON_AUTH_BASE_URL",
    "NEON_AUTH_COOKIE_SECRET",
    "VITE_NEON_AUTH_URL",
  ]);

  return Object.freeze({
    baseUrl: classifyHttpsUrl(values.get("NEON_AUTH_BASE_URL")),
    cookieSecret: classifyCookieSecret(values.get("NEON_AUTH_COOKIE_SECRET")),
    browserAuthUrl: classifyHttpsUrl(values.get("VITE_NEON_AUTH_URL")),
  });
}

function readNamedEnvironmentValues(path, names) {
  const values = new Map();
  if (!existsSync(path)) return values;

  const allowed = new Set(names);
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || !allowed.has(match[1])) continue;
    const value = unquote(match[2].trim());
    if (value) values.set(match[1], value);
  }
  return values;
}

function classifyHttpsUrl(value) {
  if (!value) return "missing";
  return /^https:\/\/[^\s]+$/.test(value) ? "valid" : "invalid";
}

function classifyCookieSecret(value) {
  if (!value) return "missing";
  return value.length >= 32 ? "valid" : "invalid";
}

function unquote(value) {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  return (first === '"' && last === '"') || (first === "'" && last === "'")
    ? value.slice(1, -1)
    : value;
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
