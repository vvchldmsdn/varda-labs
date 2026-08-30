import "server-only";

import { cache } from "react";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import { isCanonicalSessionProviderSubject } from "@/lib/auth/session-subject-binding";
import { readNaverSession } from "@/lib/auth/naver-auth-runtime";
import {
  resolveProviderSessions,
  type CurrentSessionSubjectResult,
} from "@/lib/auth/provider-session-contract";

const AUTH_PROVIDER = "neon_auth" as const;

export type { CurrentSessionSubjectResult } from "@/lib/auth/provider-session-contract";

export const readCurrentSessionSubject = cache(
  async (): Promise<CurrentSessionSubjectResult> => {
    const neon = await readNeonSessionSubject();
    const naver = await readNaverSession();
    return resolveProviderSessions(neon, naver);
  },
);

async function readNeonSessionSubject(): Promise<CurrentSessionSubjectResult> {
  let runtime: ReturnType<typeof getAuthTransportRuntime>;
  try {
    runtime = getAuthTransportRuntime();
  } catch {
    return state("unavailable");
  }
  if (runtime.state !== "ready") return state("unavailable");

  let providerSubject: unknown;
  let emailVerified = false;
  try {
    const session = await runtime.auth.getSession();
    if (session.error) return state("unavailable");
    providerSubject = session.data?.user.id;
    emailVerified = session.data?.user.emailVerified === true;
  } catch {
    return state("unavailable");
  }

  if (providerSubject === undefined || providerSubject === null) {
    return state("unauthenticated");
  }
  if (!isCanonicalSessionProviderSubject(providerSubject)) {
    return state("invalid");
  }
  if (!emailVerified) return state("unverified");

  return Object.freeze({
    state: "authenticated",
    provider: AUTH_PROVIDER,
    providerSubject,
  });
}

function state(
  value: "unauthenticated" | "unavailable" | "invalid" | "unverified",
): CurrentSessionSubjectResult {
  return Object.freeze({ state: value });
}
