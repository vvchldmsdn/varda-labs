import "server-only";

import { createDisabledIdentityPairingClaimPresentationResponse } from "@/lib/auth/identity-pairing-claim-presentation-transport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return disabledResponse();
}

export async function POST() {
  return disabledResponse();
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
