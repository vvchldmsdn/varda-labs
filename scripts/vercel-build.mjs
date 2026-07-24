import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const PREVIEW_ENVIRONMENT = "preview";

export function getVercelBuildSteps(vercelEnvironment) {
  return vercelEnvironment === PREVIEW_ENVIRONMENT
    ? [
        "db:preview:preflight",
        "db:migrate",
        "db:preview:postflight",
        "build",
      ]
    : ["build"];
}

export function runVercelBuild({
  env = process.env,
  vercelEnvironment = env.VERCEL_ENV,
  spawn = spawnSync,
  nodeExecutable = process.execPath,
  npmExecPath = env.npm_execpath,
  platform = process.platform,
  log = console.log,
} = {}) {
  if (vercelEnvironment === PREVIEW_ENVIRONMENT) {
    const missing = [
      "DATABASE_URL",
      "DATABASE_URL_UNPOOLED",
      "NEON_PROJECT_ID",
    ].filter((name) => !env[name]?.trim());
    if (missing.length > 0) {
      throw new Error(
        `[vercel-build] Preview database evidence requires: ${missing.join(", ")}.`,
      );
    }
  }

  const steps = getVercelBuildSteps(vercelEnvironment);
  log(
    `[vercel-build] environment=${vercelEnvironment ?? "local"} steps=${steps.join(",")}`,
  );

  for (const scriptName of steps) {
    const invocation = getNpmInvocation({
      scriptName,
      nodeExecutable,
      npmExecPath,
      platform,
    });
    const result = spawn(invocation.command, invocation.args, {
      env,
      stdio: "inherit",
    });

    if (result.error) {
      throw new Error(
        `[vercel-build] npm run ${scriptName} could not start: ${result.error.message}`,
        { cause: result.error },
      );
    }
    if (result.status !== 0) {
      throw new Error(
        `[vercel-build] npm run ${scriptName} failed with exit code ${result.status ?? "unknown"}.`,
      );
    }
  }
}

export function getNpmInvocation({
  scriptName,
  nodeExecutable,
  npmExecPath,
  platform,
}) {
  if (npmExecPath) {
    return {
      command: nodeExecutable,
      args: [npmExecPath, "run", scriptName],
    };
  }

  return {
    command: platform === "win32" ? "npm.cmd" : "npm",
    args: ["run", scriptName],
  };
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  try {
    runVercelBuild();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
