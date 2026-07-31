const DATABASE_ENVIRONMENT_KEYS = Object.freeze([
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "NEON_PROJECT_ID",
]);

export function createGuardedCrossProcessClaimPresentationRuntime(
  dependencies,
) {
  const readEnvironment = readOwnDataValue(dependencies, "readEnvironment");
  const guardDatabaseTarget = readOwnDataValue(
    dependencies,
    "guardDatabaseTarget",
  );
  const createPoolPort = readOwnDataValue(dependencies, "createPoolPort");
  const executePresentation = readOwnDataValue(
    dependencies,
    "executePresentation",
  );
  const createSessionCapability = readOwnDataValue(
    dependencies,
    "createSessionCapability",
  );
  const consumeIdentityPairingClaim = readOwnDataValue(
    dependencies,
    "consumeIdentityPairingClaim",
  );
  if (
    ![
      readEnvironment,
      guardDatabaseTarget,
      createPoolPort,
      executePresentation,
      createSessionCapability,
      consumeIdentityPairingClaim,
    ].every((value) => typeof value === "function")
  ) {
    throw new Error("Cross-process claim presentation runtime unavailable");
  }

  let guardedPoolPort;

  return Object.freeze({
    async present(rawClaim) {
      const pool = getGuardedPoolPort();
      return Reflect.apply(executePresentation, undefined, [
        Object.freeze({ rawClaim, pool }),
        Object.freeze({
          createSessionCapability,
          consumeIdentityPairingClaim,
        }),
      ]);
    },
  });

  function getGuardedPoolPort() {
    if (guardedPoolPort !== undefined) return guardedPoolPort;

    const environment = snapshotDatabaseEnvironment(
      Reflect.apply(readEnvironment, undefined, []),
    );
    Reflect.apply(guardDatabaseTarget, undefined, [environment]);

    const connectionString = readOwnDataValue(
      environment,
      "DATABASE_URL_UNPOOLED",
    );
    if (typeof connectionString !== "string" || !connectionString.trim()) {
      throw new Error("Cross-process claim presentation database unavailable");
    }

    const candidate = Reflect.apply(createPoolPort, undefined, [
      connectionString,
    ]);
    if (typeof readOwnDataValue(candidate, "connect") !== "function") {
      throw new Error("Cross-process claim presentation database unavailable");
    }
    guardedPoolPort = candidate;
    return guardedPoolPort;
  }
}

function snapshotDatabaseEnvironment(source) {
  const snapshot = Object.create(null);
  for (const key of DATABASE_ENVIRONMENT_KEYS) {
    const value = readOwnDataValue(source, key);
    snapshot[key] = typeof value === "string" ? value : undefined;
  }
  return Object.freeze(snapshot);
}

function readOwnDataValue(value, key) {
  if (value === null || typeof value !== "object") return undefined;
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
