import { test } from "node:test";
import assert from "node:assert/strict";
import { runSimulationExecutionCleanup } from "../scripts/cleanup-simulation-executions.mjs";

const env = { VERCEL_ENV: "preview", SIMULATION_EXECUTION_ENVIRONMENT: "preview", SIMULATION_EXECUTION_CLEANUP_ENABLED: "true", SIMULATION_EXECUTION_STORAGE_ENABLED: "false", SIMULATION_EXECUTION_ROLLOUT: "off" };
test("rollback cleanup requires a verified target and does not access DB without execute", async () => {
  let calls = 0;
  const options = { env, guardPreview: () => true, cleanup: async () => { calls++; return { status: "completed", removed: 2 }; } };
  assert.equal((await runSimulationExecutionCleanup(options)).databaseAccess, false);
  assert.equal(calls, 0);
  assert.deepEqual(await runSimulationExecutionCleanup({ ...options, args: ["--execute"] }), { target: "preview", status: "completed", removed: 2 });
  assert.equal(calls, 1);
});
test("rollback cleanup blocks changed targets and new storage before importing the writer", async () => {
  let calls = 0;
  const base = { env, args: ["--execute"], guardPreview: () => true, cleanup: async () => { calls++; } };
  for (const override of [
    { guardPreview: () => false }, { args: ["--execute", "--force"] },
    { env: { ...env, VERCEL_ENV: "development" } },
    { env: { ...env, SIMULATION_EXECUTION_ENVIRONMENT: "production" } },
    { env: { ...env, SIMULATION_EXECUTION_CLEANUP_ENABLED: "false" } },
    { env: { ...env, SIMULATION_EXECUTION_STORAGE_ENABLED: "true" } },
    { env: { ...env, SIMULATION_EXECUTION_ROLLOUT: "qa" } },
    { env: { ...env, VERCEL_ENV: "production", SIMULATION_EXECUTION_ENVIRONMENT: "production" }, guardProduction: () => { throw Error("wrong_database"); } },
  ]) await assert.rejects(runSimulationExecutionCleanup({ ...base, ...override }));
  assert.equal(calls, 0);
});
