export type CronRuntimeConfigStatus = {
  writeGateEnabled: boolean;
  cronSecretConfigured: boolean;
  adminJobSecretConfigured: boolean;
  scheduledExecutionReady: boolean;
};

export function buildCronRuntimeConfigStatus(
  env: Readonly<Record<string, string | undefined>>,
): CronRuntimeConfigStatus {
  const writeGateEnabled = env.MARKET_CYCLE_CRON_WRITE_ENABLED === "true";
  const cronSecretConfigured = Boolean(env.CRON_SECRET?.trim());
  const adminJobSecretConfigured = Boolean(env.ADMIN_JOB_SECRET?.trim());

  return {
    writeGateEnabled,
    cronSecretConfigured,
    adminJobSecretConfigured,
    scheduledExecutionReady: writeGateEnabled && cronSecretConfigured,
  };
}
