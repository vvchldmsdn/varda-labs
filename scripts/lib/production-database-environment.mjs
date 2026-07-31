import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "dotenv";

const PRODUCTION_DATABASE_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_PROJECT_ID",
]);

export function loadProductionDatabaseEnvironmentFromEnvLocal(
  repositoryRoot,
  {
    readFile = readFileSync,
    parseEnvironment = parse,
  } = {},
) {
  const parsed = parseEnvironment(
    readFile(join(repositoryRoot, ".env.local"), {
      encoding: "utf8",
    }),
  );
  const environment = Object.create(null);
  for (const key of PRODUCTION_DATABASE_ENVIRONMENT_KEYS) {
    const value = readOwnDataValue(parsed, key);
    if (typeof value === "string") environment[key] = value;
  }
  return Object.freeze(environment);
}

function readOwnDataValue(value, key) {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return undefined;
  }
  let descriptor;
  try {
    descriptor = Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return undefined;
  }
  return descriptor && "value" in descriptor
    ? descriptor.value
    : undefined;
}
