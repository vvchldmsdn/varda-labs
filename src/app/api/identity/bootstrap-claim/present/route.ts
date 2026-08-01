import "server-only";

import {
  createDisabledIdentityPairingClaimPresentationResponse,
  createInvalidIdentityPairingClaimPresentationResponse,
  createProcessedIdentityPairingClaimPresentationResponse,
  createUnavailableIdentityPairingClaimPresentationResponse,
  readIdentityPairingClaimPresentationBody,
  validateIdentityPairingClaimPresentationMetadata,
} from "@/lib/auth/identity-pairing-claim-presentation-transport";
import {
  assessIdentityPairingClaimPresentationEnvironment,
  IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE_ENV,
} from "@/lib/auth/identity-pairing-claim-presentation-policy";
import {
  IDENTITY_PAIRING_CLAIM_PRESENTATION_STATIC_AUDITS,
  projectIdentityPairingClaimPresentationAudit,
  type IdentityPairingClaimPresentationAudit,
} from "@/lib/auth/identity-pairing-claim-presentation-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return disabledResponse();
}

export async function POST(request: Request) {
  const presentationRuntime =
    assessIdentityPairingClaimPresentationEnvironment({
      VERCEL_ENV: process.env.VERCEL_ENV,
      IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE:
        process.env[IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE_ENV],
    });
  if (presentationRuntime.state === "disabled") {
    return disabledResponse();
  }
  if (presentationRuntime.state === "misconfigured") {
    recordAudit(
      IDENTITY_PAIRING_CLAIM_PRESENTATION_STATIC_AUDITS.runtimeMisconfigured,
    );
    return createUnavailableIdentityPairingClaimPresentationResponse();
  }

  const metadata =
    validateIdentityPairingClaimPresentationMetadata(request);
  if (metadata.state === "blocked") {
    recordAudit(
      IDENTITY_PAIRING_CLAIM_PRESENTATION_STATIC_AUDITS.transportRejected,
    );
    return createInvalidIdentityPairingClaimPresentationResponse();
  }

  const body = await readIdentityPairingClaimPresentationBody(request);
  if (body.state === "blocked") {
    recordAudit(
      IDENTITY_PAIRING_CLAIM_PRESENTATION_STATIC_AUDITS.transportRejected,
    );
    return createInvalidIdentityPairingClaimPresentationResponse();
  }

  let rawClaim: string | null = body.claim;
  try {
    const { presentIdentityBootstrapClaimForCurrentSession } =
      await import(
        "@/lib/auth/private-cross-process-claim-presentation"
      );
    const result =
      await presentIdentityBootstrapClaimForCurrentSession(rawClaim);
    recordAudit(projectIdentityPairingClaimPresentationAudit(result));
    return createProcessedIdentityPairingClaimPresentationResponse();
  } catch {
    recordAudit(
      IDENTITY_PAIRING_CLAIM_PRESENTATION_STATIC_AUDITS.runtimeUnavailable,
    );
    return createUnavailableIdentityPairingClaimPresentationResponse();
  } finally {
    rawClaim = null;
  }
}

export async function PUT() {
  return disabledResponse();
}

export async function PATCH() {
  return disabledResponse();
}

export async function DELETE() {
  return disabledResponse();
}

export async function HEAD() {
  return disabledResponse();
}

export async function OPTIONS() {
  return disabledResponse();
}

function disabledResponse() {
  return createDisabledIdentityPairingClaimPresentationResponse();
}

function recordAudit(audit: IdentityPairingClaimPresentationAudit) {
  console.info(
    `[identity-pairing-claim-presentation-v1] outcome=${audit.outcome} phase=${audit.phase} category=${audit.category}`,
  );
}
