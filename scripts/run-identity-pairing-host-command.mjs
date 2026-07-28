import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { config } from "dotenv";

import {
  createIdentityPairingHostFailure,
  runIdentityPairingHostCommand,
} from "./lib/identity-pairing-host-launcher.mjs";
import {
  prepareIdentityPairingHostEnvironment,
  readIdentityPairingHostOptions,
} from "./lib/identity-pairing-host-target.mjs";

export const IDENTITY_PAIRING_HOST_REPOSITORY_ROOT = resolve(
  fileURLToPath(new URL("../", import.meta.url)),
);

export function runIdentityPairingHostCli({
  args = process.argv.slice(2),
  baseEnv = process.env,
  loadEnvironment = () =>
    config({
      path: resolve(
        IDENTITY_PAIRING_HOST_REPOSITORY_ROOT,
        ".env.local",
      ),
      quiet: true,
    }),
  runCommand = runIdentityPairingHostCommand,
  write = (value) => console.log(JSON.stringify(value)),
  writeError = (value) => console.error(JSON.stringify(value)),
} = {}) {
  let options;
  try {
    options = readIdentityPairingHostOptions(args);
  } catch {
    const failure = createIdentityPairingHostFailure({
      mode: "unknown",
      code: "host_options_invalid",
    });
    writeError(failure);
    return failure;
  }

  let env;
  try {
    loadEnvironment();
    env = prepareIdentityPairingHostEnvironment({
      baseEnv,
      branchId: options.branchId,
      branchName: options.branchName,
      endpointId: options.endpointId,
    });
  } catch {
    const failure = createIdentityPairingHostFailure({
      mode: options.mode,
      code: "host_configuration_invalid",
    });
    writeError(failure);
    return failure;
  }

  const result = runCommand({
    mode: options.mode,
    cwd: IDENTITY_PAIRING_HOST_REPOSITORY_ROOT,
    env,
  });
  if (result.status === "passed") {
    write(result);
  } else {
    writeError(result);
  }
  return result;
}

const entryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (entryUrl === import.meta.url) {
  const result = runIdentityPairingHostCli();
  if (result.status === "failed") process.exitCode = 1;
}
