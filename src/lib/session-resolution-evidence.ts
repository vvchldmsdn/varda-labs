import type {
  SessionResolutionFailureCode,
  SessionResolverResult,
} from "@/lib/session-resolver-contract";

const FAILURE_LABELS = {
  unauthenticated: "Sign-in required",
  auth_provider_unavailable: "Auth unavailable",
  identity_store_unavailable: "Identity store unavailable",
  identity_unlinked: "Not linked",
  identity_mapping_collision: "Blocked",
  identity_not_active: "Inactive",
  app_user_not_active: "Inactive",
  identity_mapping_integrity: "Blocked",
  resolver_state_invalid: "Blocked",
} as const satisfies Record<SessionResolutionFailureCode, string>;

export function sessionResolutionEvidence(
  resolution: SessionResolverResult,
): string {
  return resolution.ok ? "Resolved" : FAILURE_LABELS[resolution.failure.code];
}
