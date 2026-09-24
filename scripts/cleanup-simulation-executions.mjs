import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { guardProductionDatabaseTarget } from "../src/lib/deployment/production-database-target.ts";
import { isIsolatedReleasePreview } from "../src/lib/deployment/isolated-release-preview.ts";
import { sharedExecutionCleanupEnabled } from "../src/lib/simulation-execution-availability.ts";

// Rollback fallback: run from this reviewed revision when the older deployed
// application has no cleanup endpoint. No dotenv loading or arbitrary target.
export async function runSimulationExecutionCleanup({
  args = [], env = process.env,
  cleanup = async () => (await import("../src/db/queries/simulation-execution-cleanup.ts")).cleanupSimulationExecutions(),
  guardProduction = guardProductionDatabaseTarget,
  guardPreview = isIsolatedReleasePreview,
} = {}) {
  if (args.length > 1 || (args.length === 1 && args[0] !== "--execute")) throw Error("invalid_arguments");
  const target = env.VERCEL_ENV;
  if (target === "production") guardProduction(env);
  else if (target !== "preview" || !guardPreview(env)) throw Error("unverified_cleanup_target");
  if (!sharedExecutionCleanupEnabled(env)) throw Error("cleanup_disabled");
  if (env.SIMULATION_EXECUTION_STORAGE_ENABLED !== "false" || env.SIMULATION_EXECUTION_ROLLOUT !== "off") throw Error("disable_new_storage_before_rollback_cleanup");
  if (!args.length) return { status: "target_verified", mode: "check_only", target, databaseAccess: false };
  // The same bounded lease/CAS/batch/expiry policy as the authenticated Cron.
  const result = await cleanup();
  return { target, ...result };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await runSimulationExecutionCleanup({ args: process.argv.slice(2) }))); }
  catch { console.error("Simulation cleanup stopped. Verify the approved target, disabled storage and cleanup configuration; private error details were not logged."); process.exitCode = 1; }
}
