import "server-only";

import { Pool } from "@neondatabase/serverless";

import { createPrivateSessionConsumeCapability } from "@/lib/auth/private-session-subject-binding";
import { guardProductionDatabaseTarget } from "@/lib/deployment/production-database-target";
import { executeCrossProcessIdentityPairingClaimPresentation } from "../../../scripts/lib/cross-process-identity-pairing-claim-presentation.mjs";
import { createGuardedCrossProcessClaimPresentationRuntime } from "../../../scripts/lib/guarded-cross-process-claim-presentation-runtime.mjs";
import { consumeIdentityPairingClaim } from "../../../scripts/lib/identity-pairing-consume-writer.mjs";

type CrossProcessClaimPresentationResult = Readonly<{
  result: "consumed" | "blocked" | "failed";
}>;

const runtime = createGuardedCrossProcessClaimPresentationRuntime(
  Object.freeze({
    readEnvironment() {
      return process.env;
    },
    guardDatabaseTarget: guardProductionDatabaseTarget,
    createPoolPort,
    executePresentation:
      executeCrossProcessIdentityPairingClaimPresentation,
    createSessionCapability:
      createPrivateSessionConsumeCapability,
    consumeIdentityPairingClaim,
  }),
);

export async function presentIdentityBootstrapClaimForCurrentSession(
  rawClaim: string,
): Promise<CrossProcessClaimPresentationResult> {
  return runtime.present(rawClaim) as Promise<CrossProcessClaimPresentationResult>;
}

function createPoolPort(connectionString: string) {
  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 10_000,
  });
  const connect = pool.connect.bind(pool);
  return Object.freeze({
    connect() {
      return connect();
    },
  });
}
