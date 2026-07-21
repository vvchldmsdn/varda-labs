import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative } from "node:path";

const AUTH_RUNTIME_FILES = Object.freeze([
  "src/lib/auth/preview-auth-policy.ts",
  "src/lib/auth/preview-auth-runtime.ts",
  "src/app/api/auth/[...path]/route.ts",
  "src/app/auth/sign-in/page.tsx",
  "src/app/auth/session/page.tsx",
  "src/components/auth/preview-auth-controls.tsx",
]);

const FORBIDDEN_PRODUCT_IMPORT =
  /(?:from\s+["']@\/(?:db|db\/queries)|@neondatabase\/serverless|drizzle-orm|authIdentities|appUsers|TenantContext|getCurrentAppUser)/;
const PUBLIC_AUTH_ENVIRONMENT = /NEXT_PUBLIC_[A-Z0-9_]*AUTH[A-Z0-9_]*/;
const LOCAL_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];?/g;

export function auditPreviewAuthRuntime(root) {
  const findings = [];
  const sources = new Map();

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const authSdkVersion = packageJson.dependencies?.["@neondatabase/auth"];
  if (authSdkVersion !== "0.4.2-beta") {
    findings.push("preview_auth_sdk_version_drift");
  }

  for (const path of AUTH_RUNTIME_FILES) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) {
      findings.push("required_file_missing");
      continue;
    }
    sources.set(path, readFileSync(absolutePath, "utf8"));
  }

  const runtimeGraph = collectLocalImportGraph(root, AUTH_RUNTIME_FILES);
  const runtimeSources = [...runtimeGraph.values()];
  const productBoundaryFiles = [...runtimeGraph.entries()]
    .filter(([, source]) => FORBIDDEN_PRODUCT_IMPORT.test(source))
    .map(([path]) => path);
  if (productBoundaryFiles.length !== 0) {
    findings.push("product_data_boundary_crossed");
  }
  if (runtimeSources.some((source) => PUBLIC_AUTH_ENVIRONMENT.test(source))) {
    findings.push("public_auth_environment_reference");
  }

  const policy = sources.get("src/lib/auth/preview-auth-policy.ts") ?? "";
  if (!policy.includes('VERCEL_ENV?.trim() !== "preview"')) {
    findings.push("preview_environment_gate_missing");
  }
  if (
    !policy.includes("VERCEL_GIT_COMMIT_REF") ||
    !policy.includes("PREVIEW_AUTH_ALLOWED_GIT_REF")
  ) {
    findings.push("preview_git_ref_gate_missing");
  }
  if (!policy.includes("cookieSecret.length < 32")) {
    findings.push("cookie_secret_length_guard_missing");
  }

  const runtime = sources.get("src/lib/auth/preview-auth-runtime.ts") ?? "";
  if (!runtime.includes('import "server-only"')) {
    findings.push("server_only_boundary_missing");
  }
  if (!runtime.includes('logLevel: "silent"')) {
    findings.push("silent_auth_logging_missing");
  }

  const route = sources.get("src/app/api/auth/[...path]/route.ts") ?? "";
  if (!route.includes('runtime.state === "disabled"') || !route.includes("status: 404")) {
    findings.push("production_disabled_response_missing");
  }
  if (
    /export\s+(?:(?:async\s+)?function|const)\s+(?:PUT|PATCH|DELETE)/.test(
      route,
    )
  ) {
    findings.push("unneeded_auth_method_exposed");
  }

  const sessionPage = sources.get("src/app/auth/session/page.tsx") ?? "";
  if (/\.user\.(?:email|name|image)|provider[_A-Z]?subject/i.test(sessionPage)) {
    findings.push("session_profile_exposed");
  }

  const proxy = readFileSync(join(root, "src/proxy.ts"), "utf8");
  const basicAuthBoundaryIntact = [
    "VARDA_APP_PASSWORD",
    "APP_ACCESS_PASSWORD",
    "WWW-Authenticate",
  ].every((marker) => proxy.includes(marker));
  if (!basicAuthBoundaryIntact) findings.push("basic_auth_boundary_drift");
  if (/['"]\/auth(?:\/|['"])/.test(proxy)) {
    findings.push("auth_smoke_added_to_basic_auth_matcher");
  }

  const schema = readFileSync(join(root, "src/db/schema.ts"), "utf8");
  const managedAuthSchemaOwnedByDrizzle =
    /(?:pgSchema|schema)\s*\(\s*["']neon_auth["']/.test(schema);
  if (managedAuthSchemaOwnedByDrizzle) {
    findings.push("managed_neon_auth_schema_owned_by_drizzle");
  }

  return Object.freeze({
    audit: "preview_auth_session_transport_smoke",
    status: findings.length === 0 ? "passed" : "failed",
    findings: Object.freeze([...new Set(findings)]),
    evidence: Object.freeze({
      requiredFiles: AUTH_RUNTIME_FILES.length,
      presentFiles: sources.size,
      inspectedRuntimeGraphFiles: runtimeGraph.size,
      productDatabaseBoundaryFiles: productBoundaryFiles.length,
      publicAuthEnvironmentReferences: runtimeSources.filter((source) =>
        PUBLIC_AUTH_ENVIRONMENT.test(source),
      ).length,
      previewAuthSdkPinned: authSdkVersion === "0.4.2-beta",
      previewGitRefGatePresent:
        policy.includes("VERCEL_GIT_COMMIT_REF") &&
        policy.includes("PREVIEW_AUTH_ALLOWED_GIT_REF"),
      basicAuthBoundaryIntact,
      managedAuthSchemaOwnedByDrizzle,
      managedAuthSessionIoExpected: true,
    }),
  });
}

function collectLocalImportGraph(root, entryPaths) {
  const graph = new Map();
  const pending = [...entryPaths];

  while (pending.length !== 0) {
    const path = pending.pop();
    if (!path || graph.has(path)) continue;

    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) continue;

    const source = readFileSync(absolutePath, "utf8");
    graph.set(path, source);

    for (const specifier of readImportSpecifiers(source)) {
      const resolved = resolveLocalImport(root, path, specifier);
      if (resolved && !graph.has(resolved)) pending.push(resolved);
    }
  }

  return graph;
}

function readImportSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(LOCAL_IMPORT)) specifiers.push(match[1]);
  return specifiers;
}

function resolveLocalImport(root, importerPath, specifier) {
  if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return null;

  const basePath = specifier.startsWith("@/")
    ? join(root, "src", specifier.slice(2))
    : join(root, dirname(importerPath), specifier);
  const candidates = extname(basePath)
    ? [basePath]
    : [
        `${basePath}.ts`,
        `${basePath}.tsx`,
        `${basePath}.js`,
        `${basePath}.mjs`,
        join(basePath, "index.ts"),
        join(basePath, "index.tsx"),
      ];
  const absolutePath = candidates.find((candidate) => existsSync(candidate));
  if (!absolutePath) return null;

  return normalize(relative(root, absolutePath)).replaceAll("\\", "/");
}
