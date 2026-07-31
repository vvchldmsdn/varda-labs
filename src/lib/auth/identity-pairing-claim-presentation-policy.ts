export const IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE_ENV =
  "IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE";
export const IDENTITY_PAIRING_CLAIM_PRESENTATION_DEFAULT_MODE =
  "disabled";
export const IDENTITY_PAIRING_CLAIM_PRESENTATION_ENABLED_MODE =
  "enabled_v1";

export type IdentityPairingClaimPresentationEnvironment = Readonly<{
  VERCEL_ENV?: string;
  IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE?: string;
}>;

export type IdentityPairingClaimPresentationRuntimeState =
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "misconfigured" }>
  | Readonly<{ state: "enabled" }>;

export function assessIdentityPairingClaimPresentationEnvironment(
  environment: IdentityPairingClaimPresentationEnvironment,
): IdentityPairingClaimPresentationRuntimeState {
  const configuredMode =
    environment.IDENTITY_PAIRING_CLAIM_PRESENTATION_MODE;
  const mode = configuredMode?.trim();

  if (
    configuredMode === undefined ||
    mode === IDENTITY_PAIRING_CLAIM_PRESENTATION_DEFAULT_MODE
  ) {
    return Object.freeze({ state: "disabled" });
  }
  if (
    mode !== IDENTITY_PAIRING_CLAIM_PRESENTATION_ENABLED_MODE ||
    environment.VERCEL_ENV?.trim() !== "production"
  ) {
    return Object.freeze({ state: "misconfigured" });
  }

  return Object.freeze({ state: "enabled" });
}
