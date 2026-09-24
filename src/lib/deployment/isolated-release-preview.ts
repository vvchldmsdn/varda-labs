/** A single verified empty Neon project. This is not a general Preview auth bypass. */
export const ISOLATED_RELEASE_PREVIEW = Object.freeze({
  branch: "codex/bc-production-release-20260920",
  project: "rapid-rain-28976365",
  endpoint: "ep-lingering-truth-auldpusa",
  database: "neondb",
  authBaseUrl: "https://ep-lingering-truth-auldpusa.neonauth.c-10.us-east-1.aws.neon.tech/neondb/auth",
});

export function isIsolatedReleasePreview(env: Readonly<Record<string, string | undefined>>) {
  if (env.VERCEL_ENV !== "preview" || env.BC_ISOLATED_PREVIEW_ENABLED !== "true"
    || env.VERCEL_GIT_COMMIT_REF !== ISOLATED_RELEASE_PREVIEW.branch
    || env.NEON_PROJECT_ID !== ISOLATED_RELEASE_PREVIEW.project
    || env.NEON_AUTH_BASE_URL !== ISOLATED_RELEASE_PREVIEW.authBaseUrl) return false;
  try {
    const urls = [env.DATABASE_URL, env.DATABASE_URL_UNPOOLED, env.TENANT_DATABASE_URL].map(value => new URL(value!));
    if (!urls.every(url => ["postgres:", "postgresql:"].includes(url.protocol)
      && url.hostname.endsWith(".us-east-1.aws.neon.tech")
      && url.hostname.split(".")[0].replace(/-pooler$/, "") === ISOLATED_RELEASE_PREVIEW.endpoint
      && url.pathname === `/${ISOLATED_RELEASE_PREVIEW.database}` && url.username && url.password
      && (!url.port || url.port === "5432") && !url.hash
      && [...url.searchParams].every(([key, value]) =>
        ((key === "sslmode" && ["require", "verify-full"].includes(value)) || (key === "channel_binding" && value === "require"))
        && url.searchParams.getAll(key).length === 1)
      && url.searchParams.has("sslmode"))) return false;
    const credentials = urls.map(url => ({ user: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }));
    return credentials[0].user === credentials[1].user && credentials[0].password === credentials[1].password
      && credentials[2].user === "varda_tenant_app" && credentials[2].user !== credentials[0].user && credentials[2].password !== credentials[0].password;
  } catch { return false; }
}
