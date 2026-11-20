import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { getAuthTransportRuntime } from "./auth-transport-runtime";

/** Request-local only. Never cache a user's session across requests or tenants. */
export const readCurrentNeonSession = cache(async () => {
  try {
    const runtime = getAuthTransportRuntime();
    // Configuration failures remain unavailable, including anonymous requests.
    if (runtime.state !== "ready") return { state: "unavailable" } as const;
    const jar = await cookies();
    // This is the exact prefix forwarded by the installed Neon SDK. Any matching
    // cookie (including chunks, invalid data or OAuth challenge) still goes to
    // the SDK. Absence alone cannot authenticate anyone or grant data access.
    if (!jar.getAll().some(({ name }) => name.startsWith("__Secure-neon-auth"))) {
      return { state: "unauthenticated" } as const;
    }
    const result = await runtime.auth.getSession();
    if (result.error) return { state: "unavailable" } as const;
    // An absent session is normal. A non-null response without the expected
    // user envelope is a transport failure, not evidence of a signed-out user.
    if (result.data === null || result.data === undefined) {
      return { state: "unauthenticated" } as const;
    }
    const data: unknown = result.data;
    if (!isRecord(data) || !isRecord(data.user) || data.user.id == null) {
      return { state: "unavailable" } as const;
    }
    return { state: "read", data: result.data } as const;
  } catch {
    return { state: "unavailable" } as const;
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
