import "server-only";

import { cache } from "react";
import { readCurrentNeonSession } from "@/lib/auth/current-neon-session";
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
  const session = await readCurrentNeonSession();
  if (session.state !== "read") return state(session.state);
  const providerSubject: unknown = session.data?.user.id;
  const emailVerified = session.data?.user.emailVerified === true;

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
