import { isCanonicalSessionProviderSubject } from "./session-subject-binding.ts";

export type SessionIdentityProvider = "neon_auth" | "naver";
export type CurrentSessionSubjectResult =
  | Readonly<{
      state: "unauthenticated" | "unavailable" | "invalid" | "unverified";
    }>
  | Readonly<{
      state: "authenticated";
      provider: SessionIdentityProvider;
      providerSubject: string;
    }>;

export function verifiedProviderSession(
  provider: SessionIdentityProvider,
  subject: unknown,
): CurrentSessionSubjectResult {
  if (!isCanonicalSessionProviderSubject(subject)) return { state: "invalid" };
  return Object.freeze({
    state: "authenticated",
    provider,
    providerSubject: subject,
  });
}

export function resolveProviderSessions(
  neon: CurrentSessionSubjectResult,
  naver: CurrentSessionSubjectResult,
): CurrentSessionSubjectResult {
  if (neon.state === "invalid" || naver.state === "invalid")
    return { state: "invalid" };
  if (neon.state === "unavailable" || naver.state === "unavailable")
    return { state: "unavailable" };
  const neonPresent =
    neon.state === "authenticated" || neon.state === "unverified";
  if (neonPresent && naver.state === "authenticated")
    return { state: "invalid" };
  if (neonPresent) return neon;
  return naver;
}
