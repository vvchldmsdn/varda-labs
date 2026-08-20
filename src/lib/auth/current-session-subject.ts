import "server-only";

import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import { isCanonicalSessionProviderSubject } from "@/lib/auth/session-subject-binding";

const AUTH_PROVIDER = "neon_auth" as const;

export type CurrentSessionSubjectResult =
  | Readonly<{ state: "unauthenticated" }>
  | Readonly<{ state: "unavailable" }>
  | Readonly<{ state: "invalid" }>
  | Readonly<{
      state: "authenticated";
      provider: typeof AUTH_PROVIDER;
      providerSubject: string;
    }>;

export async function readCurrentSessionSubject(): Promise<CurrentSessionSubjectResult> {
  let runtime: ReturnType<typeof getAuthTransportRuntime>;
  try {
    runtime = getAuthTransportRuntime();
  } catch {
    return state("unavailable");
  }
  if (runtime.state !== "ready") return state("unavailable");

  let providerSubject: unknown;
  try {
    const session = await runtime.auth.getSession();
    if (session.error) return state("unavailable");
    providerSubject = session.data?.user.id;
  } catch {
    return state("unavailable");
  }

  if (providerSubject === undefined || providerSubject === null) {
    return state("unauthenticated");
  }
  if (!isCanonicalSessionProviderSubject(providerSubject)) {
    return state("invalid");
  }

  return Object.freeze({
    state: "authenticated",
    provider: AUTH_PROVIDER,
    providerSubject,
  });
}

function state(
  value: "unauthenticated" | "unavailable" | "invalid",
): CurrentSessionSubjectResult {
  return Object.freeze({ state: value });
}
