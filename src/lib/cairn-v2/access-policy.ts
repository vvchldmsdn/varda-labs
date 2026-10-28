export function betaFixtureAccessAllowed({ nodeEnv, enabled, vercel, vercelEnv, host, forwardedHost }: {
  nodeEnv?: string; enabled?: string; vercel?: string; vercelEnv?: string;
  host: string | null; forwardedHost: string | null;
}) {
  return nodeEnv === "development" && enabled === "1" && !vercel && !vercelEnv &&
    (!forwardedHost || forwardedHost === host) && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host ?? "");
}
