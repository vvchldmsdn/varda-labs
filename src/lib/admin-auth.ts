import "server-only";

export function isAuthorizedAdminJob(headers: Headers) {
  const configuredSecrets = getConfiguredSecrets();
  const presentedSecret = getPresentedSecret(headers);

  return (
    presentedSecret !== null &&
    configuredSecrets.some((secret) => presentedSecret === secret)
  );
}

function getConfiguredSecrets() {
  return [process.env.ADMIN_JOB_SECRET, process.env.CRON_SECRET]
    .map((secret) => secret?.trim())
    .filter((secret): secret is string => Boolean(secret));
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
