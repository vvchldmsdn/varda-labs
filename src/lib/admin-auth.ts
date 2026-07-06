import "server-only";

export function isAuthorizedAdminJob(headers: Headers) {
  const configuredSecret = getConfiguredSecret();
  const presentedSecret = getPresentedSecret(headers);

  return configuredSecret !== null && presentedSecret === configuredSecret;
}

function getConfiguredSecret() {
  const secret = process.env.ADMIN_JOB_SECRET ?? process.env.CRON_SECRET;
  const normalized = secret?.trim();
  return normalized ? normalized : null;
}

function getPresentedSecret(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  const bearerPrefix = "Bearer ";

  if (authorization?.startsWith(bearerPrefix)) {
    const token = authorization.slice(bearerPrefix.length).trim();
    return token ? token : null;
  }

  const headerSecret = headers.get("x-admin-job-secret")?.trim();
  return headerSecret ? headerSecret : null;
}
