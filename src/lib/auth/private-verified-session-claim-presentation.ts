import "server-only";

import { executeVerifiedSessionClaimPresentation } from "../../../scripts/lib/verified-session-claim-presentation.mjs";
import { startOneUserBootstrapExecution } from "../../../scripts/lib/one-user-bootstrap-execution.mjs";
import { readPrivateSessionSubjectBinding } from "@/lib/auth/private-session-subject-binding";

type ClaimIssuerPortFactory = () => unknown | Promise<unknown>;

type PrivateClaimPresentationPort = Readonly<{
  present(input: Readonly<{
    rawClaim: string;
    executionBinding: Readonly<Record<string, string>>;
  }>): Promise<unknown>;
}>;

export type VerifiedSessionClaimPresentationInput = Readonly<{
  targetAppUserSha256: string;
  createClaimIssuerPort: ClaimIssuerPortFactory;
  privateClaimPresentationPort: PrivateClaimPresentationPort;
}>;

export function presentIdentityBootstrapClaimForVerifiedSession(
  input: VerifiedSessionClaimPresentationInput,
) {
  return executeVerifiedSessionClaimPresentation(
    input,
    Object.freeze({
      readSessionBinding: readPrivateSessionSubjectBinding,
      startExecution: startOneUserBootstrapExecution,
    }),
  );
}
