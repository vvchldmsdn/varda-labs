import "server-only";

import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";

declare const verifiedNeonSubjectBrand: unique symbol;

export type VerifiedNeonSubject = Readonly<{
  provider: "neon_auth";
  subject: string & { readonly [verifiedNeonSubjectBrand]: true };
  verificationSource: "server_verified_session";
}>;

export type VerifiedNeonSubjectUseResult<T> =
  | Readonly<{ state: "missing" | "unavailable" }>
  | Readonly<{ state: "verified"; value: T }>;

export type VerifiedNeonSubjectPort = Readonly<{
  use<T>(
    consumer: (subject: VerifiedNeonSubject) => Promise<T>,
  ): Promise<VerifiedNeonSubjectUseResult<T>>;
}>;

export const verifiedNeonSubjectPort: VerifiedNeonSubjectPort = Object.freeze({
  async use<T>(
    consumer: (subject: VerifiedNeonSubject) => Promise<T>,
  ): Promise<VerifiedNeonSubjectUseResult<T>> {
    const runtime = getAuthTransportRuntime();
    if (runtime.state !== "ready") {
      return Object.freeze({ state: "unavailable" });
    }

    let session;
    try {
      session = await runtime.auth.getSession();
    } catch {
      return Object.freeze({ state: "unavailable" });
    }

    if (session.error) return Object.freeze({ state: "unavailable" });

    const rawSubject = session.data?.user.id;
    if (
      typeof rawSubject !== "string" ||
      rawSubject.length === 0 ||
      rawSubject.length > 255 ||
      rawSubject.trim() !== rawSubject
    ) {
      return Object.freeze({ state: "missing" });
    }

    const value = await consumer(
      Object.freeze({
        provider: "neon_auth",
        subject: rawSubject as VerifiedNeonSubject["subject"],
        verificationSource: "server_verified_session",
      }),
    );
    return Object.freeze({ state: "verified", value });
  },
});
