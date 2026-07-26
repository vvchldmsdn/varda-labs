import "server-only";

import { createDisabledIdentityPairingClaimPresentationResponse } from "@/lib/auth/identity-pairing-claim-presentation-transport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  return createDisabledIdentityPairingClaimPresentationResponse();
}
