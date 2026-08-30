import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, normalize, relative } from "node:path";

const AUTH_TRANSPORT_RUNTIME_FILES = Object.freeze([
  "src/lib/auth/auth-transport-api-contract.ts",
  "src/lib/auth/auth-transport-policy.ts",
  "src/lib/auth/auth-transport-proxy.ts",
  "src/lib/auth/auth-transport-request.ts",
  "src/lib/auth/auth-transport-routes.ts",
  "src/lib/auth/auth-transport-runtime.ts",
  "src/app/api/auth/[...path]/route.ts",
  "src/app/auth/callback/page.tsx",
  "src/app/auth/sign-in/page.tsx",
  "src/app/auth/sign-up/page.tsx",
  "src/app/auth/session/page.tsx",
  "src/components/auth/auth-transport-controls.tsx",
  "src/proxy.ts",
]);

const FORBIDDEN_PRODUCT_IMPORT =
  /(?:from\s+["']@\/(?:db|db\/queries)|@neondatabase\/serverless|drizzle-orm|authIdentities|appUsers|TenantContext|getCurrentAppUser)/;
const PUBLIC_AUTH_ENVIRONMENT = /NEXT_PUBLIC_[A-Z0-9_]*AUTH[A-Z0-9_]*/;
const LOCAL_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["'];?/g;

export function auditAuthTransportRuntime(root) {
  const findings = [];
  const sources = new Map();

  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const authSdkVersion = packageJson.dependencies?.["@neondatabase/auth"];
  if (authSdkVersion !== "0.4.2-beta") {
    findings.push("auth_sdk_version_drift");
  }

  for (const path of AUTH_TRANSPORT_RUNTIME_FILES) {
    const absolutePath = join(root, path);
    if (!existsSync(absolutePath)) {
      findings.push("required_file_missing");
      continue;
    }
    sources.set(path, readFileSync(absolutePath, "utf8"));
  }

  const runtimeGraph = collectLocalImportGraph(
    root,
    AUTH_TRANSPORT_RUNTIME_FILES,
  );
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

  const policy = sources.get("src/lib/auth/auth-transport-policy.ts") ?? "";
  const previewRuntimeEnabled =
    policy.includes("AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS") &&
    policy.includes('"preview"');
  const productionRuntimeEnabled =
    policy.includes("AUTH_TRANSPORT_ALLOWED_ENVIRONMENTS") &&
    policy.includes('"production"');
  if (previewRuntimeEnabled || !productionRuntimeEnabled) {
    findings.push("auth_environment_gate_incomplete");
  }
  if (!policy.includes("cookieSecret.length < 32")) {
    findings.push("cookie_secret_length_guard_missing");
  }
  const authTargetFingerprintGuardPresent =
    policy.includes("NEON_AUTH_BASE_URL_SHA256") &&
    policy.includes("createAuthTransportBaseUrlFingerprint") &&
    policy.includes("actualBaseUrlFingerprint !== expectedBaseUrlFingerprint");
  if (!authTargetFingerprintGuardPresent) {
    findings.push("auth_target_fingerprint_guard_missing");
  }

  const runtime = sources.get("src/lib/auth/auth-transport-runtime.ts") ?? "";
  if (!runtime.includes('import "server-only"')) {
    findings.push("server_only_boundary_missing");
  }
  if (!runtime.includes('logLevel: "silent"')) {
    findings.push("silent_auth_logging_missing");
  }

  const route = sources.get("src/app/api/auth/[...path]/route.ts") ?? "";
  const apiContract =
    sources.get("src/lib/auth/auth-transport-api-contract.ts") ?? "";
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
  const allowedAuthApiEndpoints =
    (policy.match(/method:\s*"(?:GET|POST)"/g) ?? []).length;
  const googleSocialProviderRestricted =
    policy.includes('socialProvider: "google"') &&
    route.includes("isAuthTransportApiRequestAllowed") &&
    route.includes("createReviewedGoogleSocialSignInRequest") &&
    route.indexOf("isAuthTransportApiRequestAllowed") <
      route.indexOf("runtime.auth.handler()");
  const strictGoogleSocialSignInBody =
    apiContract.includes("AUTH_TRANSPORT_GOOGLE_SOCIAL_SIGN_IN_BODY") &&
    apiContract.includes("Object.getOwnPropertyDescriptors") &&
    apiContract.includes("AUTH_TRANSPORT_MAX_SOCIAL_SIGN_IN_BODY_BYTES") &&
    route.includes("forwardedRequest") &&
    route.indexOf("createReviewedGoogleSocialSignInRequest") <
      route.indexOf("runtime.auth.handler()");
  if (allowedAuthApiEndpoints !== 2) {
    findings.push("auth_endpoint_allowlist_drift");
  }
  if (!googleSocialProviderRestricted) {
    findings.push("auth_social_provider_guard_missing");
  }
  if (!strictGoogleSocialSignInBody) {
    findings.push("auth_social_sign_in_body_contract_missing");
  }

  const sessionPage = sources.get("src/app/auth/session/page.tsx") ?? "";
  if (/\.user\.(?:email|name|image)|provider[_A-Z]?subject/i.test(sessionPage)) {
    findings.push("session_profile_exposed");
  }
  const callbackPage = sources.get("src/app/auth/callback/page.tsx") ?? "";
  const routes = sources.get("src/lib/auth/auth-transport-routes.ts") ?? "";
  if (
    !callbackPage.includes("redirect(AUTH_TRANSPORT_SESSION_PATH)") ||
    !routes.includes('AUTH_TRANSPORT_CALLBACK_PATH = "/auth/callback"') ||
    !routes.includes('AUTH_TRANSPORT_SESSION_PATH = "/auth/session"')
  ) {
    findings.push("dedicated_callback_route_missing");
  }

  const authProxy = sources.get("src/lib/auth/auth-transport-proxy.ts") ?? "";
  const requestSanitizer =
    sources.get("src/lib/auth/auth-transport-request.ts") ?? "";
  const proxy = sources.get("src/proxy.ts") ?? "";
  const basicAuthBoundaryIntact = [
    "VARDA_APP_PASSWORD",
    "APP_ACCESS_PASSWORD",
    "WWW-Authenticate",
  ].every((marker) => proxy.includes(marker));
  if (!basicAuthBoundaryIntact) findings.push("basic_auth_boundary_drift");

  const authEntryOutsideBasicAuthMatcher =
    !proxy.includes('"/auth/sign-in"') &&
    !proxy.includes('"/api/auth/:path*"');
  if (!authEntryOutsideBasicAuthMatcher) {
    findings.push("auth_entry_still_behind_basic_auth");
  }

  const callbackBranchMarker =
    "request.nextUrl.pathname === AUTH_TRANSPORT_CALLBACK_PATH";
  const basicAuthMarker = "return enforceDashboardBasicAuth(request)";
  const callbackBranchIndex = proxy.indexOf(callbackBranchMarker);
  const basicAuthIndex = proxy.indexOf(basicAuthMarker);
  const authCallbackBypassesBasicAuth =
    callbackBranchIndex >= 0 &&
    basicAuthIndex >= 0 &&
    callbackBranchIndex < basicAuthIndex &&
    proxy.includes('"/auth/callback"');
  if (!authCallbackBypassesBasicAuth) {
    findings.push("auth_callback_basic_auth_isolation_missing");
  }
  const sessionEvidenceOutsideBasicAuthMatcher =
    !proxy.includes('"/auth/session"') &&
    !routes.includes('AUTH_TRANSPORT_CALLBACK_PATH = "/auth/session"');
  if (!sessionEvidenceOutsideBasicAuthMatcher) {
    findings.push("session_evidence_still_behind_basic_auth");
  }

  const oauthCallbackExchangeProxyPresent =
    authProxy.includes("runtime.auth.middleware") &&
    authProxy.includes('loginUrl: "/auth/sign-in"') &&
    authProxy.includes('runtime.state === "disabled"') &&
    authProxy.includes('runtime.state === "misconfigured"');
  if (!oauthCallbackExchangeProxyPresent) {
    findings.push("oauth_callback_exchange_proxy_missing");
  }
  const callbackFailureClosed =
    authProxy.includes("status: 404") &&
    authProxy.includes("status: 503") &&
    !authProxy.includes("NextResponse.next()");
  if (!callbackFailureClosed) {
    findings.push("auth_callback_failure_closed_missing");
  }
  const dashboardCredentialHeadersStripped =
    requestSanitizer.includes('"authorization"') &&
    requestSanitizer.includes('"proxy-authorization"') &&
    requestSanitizer.includes("sanitizedHeaders.delete(header)") &&
    route.includes("createAuthTransportUpstreamRequest(forwardedRequest)") &&
    route.indexOf("createAuthTransportUpstreamRequest(forwardedRequest)") <
      route.indexOf("runtime.auth.handler()") &&
    authProxy.includes("createAuthTransportUpstreamHeaders(request.headers)") &&
    authProxy.indexOf("createAuthTransportUpstreamHeaders(request.headers)") <
      authProxy.indexOf("runtime.auth.middleware");
  if (!dashboardCredentialHeadersStripped) {
    findings.push("dashboard_auth_credential_sanitizer_missing");
  }

  const schema = readFileSync(join(root, "src/db/schema.ts"), "utf8");
  const managedAuthSchemaOwnedByDrizzle =
    /(?:pgSchema|schema)\s*\(\s*["']neon_auth["']/.test(schema);
  if (managedAuthSchemaOwnedByDrizzle) {
    findings.push("managed_neon_auth_schema_owned_by_drizzle");
  }

  return Object.freeze({
    audit: "auth_session_transport_smoke",
    status: findings.length === 0 ? "passed" : "failed",
    findings: Object.freeze([...new Set(findings)]),
    evidence: Object.freeze({
      requiredFiles: AUTH_TRANSPORT_RUNTIME_FILES.length,
      presentFiles: sources.size,
      inspectedRuntimeGraphFiles: runtimeGraph.size,
      productDatabaseBoundaryFiles: productBoundaryFiles.length,
      publicAuthEnvironmentReferences: runtimeSources.filter((source) =>
        PUBLIC_AUTH_ENVIRONMENT.test(source),
      ).length,
      authSdkPinned: authSdkVersion === "0.4.2-beta",
      previewRuntimeDisabled: !previewRuntimeEnabled,
      productionRuntimeEnabled,
      authTargetFingerprintGuardPresent,
      allowedAuthApiEndpoints,
      googleSocialProviderRestricted,
      strictGoogleSocialSignInBody,
      basicAuthBoundaryIntact,
      oauthCallbackExchangeProxyPresent,
      authEntryOutsideBasicAuthMatcher,
      authCallbackBypassesBasicAuth,
      sessionEvidenceOutsideBasicAuthMatcher,
      callbackFailureClosed,
      dashboardCredentialHeadersStripped,
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
