import "server-only";

import { consumeIdentityPairingClaim } from "../../../scripts/lib/identity-pairing-consume-writer.mjs";
import { executeVerifiedSessionIdentityConsume } from "../../../scripts/lib/verified-session-identity-consume.mjs";
import { createPrivateSessionConsumeCapability } from "@/lib/auth/private-session-subject-binding";

type IdentityPairingPool = Readonly<{
  connect(): Promise<unknown>;
}>;

type PrivateClaimContinuationPort = Readonly<{
  take(input: Readonly<{
    executionBinding: Readonly<Record<string, string>>;
  }>): unknown | Promise<unknown>;
}>;

export type VerifiedSessionIdentityConsumeInput = Readonly<{
  executionBinding: Readonly<Record<string, string>>;
  claimContinuationPort: PrivateClaimContinuationPort;
  pool: IdentityPairingPool;
}>;

export function consumePresentedIdentityBootstrapClaimForVerifiedSession(
  input: VerifiedSessionIdentityConsumeInput,
) {
  return executeVerifiedSessionIdentityConsume(
    input,
    Object.freeze({
      createSessionCapability:
        createPrivateSessionConsumeCapability,
      consumeIdentityPairingClaim,
    }),
  );
}
