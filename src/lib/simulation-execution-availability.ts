/** Explicit environment admission. No production RAM or cross-environment fallback. */
export function sharedExecutionEnabled(env: Record<string, string | undefined>) {
  return env.SIMULATION_EXECUTION_STORAGE_ENABLED === "true" && sharedExecutionCleanupEnabled(env);
}
export function sharedExecutionOwnerEnabled(env: Record<string, string | undefined>, owner: string) {
  return sharedExecutionEnabled(env) && releaseOwnerAllowed(env, "SIMULATION_EXECUTION", owner);
}
export function sharedExecutionCleanupEnabled(env: Record<string, string | undefined>) {
  const target = env.VERCEL_ENV ?? (env.NODE_ENV === "production" ? "production" : "development");
  return env.SIMULATION_EXECUTION_CLEANUP_ENABLED === "true"
    && env.SIMULATION_EXECUTION_ENVIRONMENT === target;
}
import { releaseOwnerAllowed } from "./release-admission.ts";
