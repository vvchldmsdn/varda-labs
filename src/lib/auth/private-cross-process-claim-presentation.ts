import "server-only";

import { Pool } from "@neondatabase/serverless";

import { createPrivateSessionConsumeCapability } from "@/lib/auth/private-session-subject-binding";
import { executeCrossProcessIdentityPairingClaimPresentation } from "../../../scripts/lib/cross-process-identity-pairing-claim-presentation.mjs";
import { consumeIdentityPairingClaim } from "../../../scripts/lib/identity-pairing-consume-writer.mjs";

type CrossProcessClaimPresentationResult = Readonly<{
  result: "consumed" | "blocked" | "failed";
}>;

type IdentityPairingPoolPort = Readonly<{
  connect(): Promise<unknown>;
}>;

let poolPort: IdentityPairingPoolPort | undefined;

export async function presentIdentityBootstrapClaimForCurrentSession(
  rawClaim: string,
): Promise<CrossProcessClaimPresentationResult> {
  return executeCrossProcessIdentityPairingClaimPresentation(
    Object.freeze({
      rawClaim,
      pool: getIdentityPairingPoolPort(),
    }),
    Object.freeze({
      createSessionCapability:
        createPrivateSessionConsumeCapability,
      consumeIdentityPairingClaim,
    }),
  ) as Promise<CrossProcessClaimPresentationResult>;
}

function getIdentityPairingPoolPort(): IdentityPairingPoolPort {
  if (poolPort) return poolPort;

  const connectionString =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("Identity pairing database unavailable");
  }

  const pool = new Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 8_000,
    idleTimeoutMillis: 10_000,
  });
  const connect = pool.connect.bind(pool);
  poolPort = Object.freeze({
    connect() {
      return connect();
    },
  });
  return poolPort;
}
