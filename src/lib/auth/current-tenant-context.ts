import "server-only";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db/client";
import { appUsers, authIdentities } from "@/db/schema";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import { isCanonicalSessionProviderSubject } from "@/lib/auth/session-subject-binding";
import {
  resolveSessionToAppUser,
  type AppUserRole,
  type AppUserStatus,
  type AppUserPortResult,
  type IdentityMappingPortResult,
  type SessionResolverResult,
} from "@/lib/session-resolver-contract";

const AUTH_PROVIDER = "neon_auth";

export const resolveCurrentTenantContext = cache(
  async (): Promise<SessionResolverResult> => {
    let runtime: ReturnType<typeof getAuthTransportRuntime>;
    try {
      runtime = getAuthTransportRuntime();
    } catch {
      return resolveSessionToAppUser(notStarted("unavailable"));
    }
    if (runtime.state !== "ready") {
      return resolveSessionToAppUser(notStarted("unavailable"));
    }

    let providerSubject: unknown;
    try {
      const session = await runtime.auth.getSession();
      if (session.error) {
        return resolveSessionToAppUser(notStarted("unavailable"));
      }
      providerSubject = session.data?.user.id;
    } catch {
      return resolveSessionToAppUser(notStarted("unavailable"));
    }

    if (providerSubject === undefined || providerSubject === null) {
      return resolveSessionToAppUser(notStarted("unauthenticated"));
    }
    if (!isCanonicalSessionProviderSubject(providerSubject)) {
      return resolveSessionToAppUser(
        authenticated({ state: "invalid" }),
      );
    }

    let rows: Awaited<ReturnType<typeof readIdentityMapping>>;
    try {
      rows = await readIdentityMapping(providerSubject);
    } catch {
      return resolveSessionToAppUser(
        authenticated({ state: "unavailable" }),
      );
    }

    if (rows.length === 0) {
      return resolveSessionToAppUser(
        authenticated({ state: "unlinked" }),
      );
    }
    if (rows.length !== 1) {
      return resolveSessionToAppUser(
        authenticated({ state: "collision" }),
      );
    }

    const [row] = rows;
    const identityMapping: IdentityMappingPortResult = {
      state: "mapped",
      appUserId: row.appUserId,
      identityStatus: row.identityStatus as "active" | "disabled",
    };
    const appUser: AppUserPortResult =
      row.identityStatus !== "active"
        ? { state: "not_requested" }
        : row.appUserStatus === null ||
            row.appUserRole === null ||
            row.loadedAppUserId === null
          ? { state: "missing" }
          : {
              state: "loaded",
              id: row.loadedAppUserId,
              status: row.appUserStatus as AppUserStatus,
              role: row.appUserRole as AppUserRole,
            };

    return resolveSessionToAppUser({
      providerSession: { state: "authenticated" },
      identityMapping,
      appUser,
    });
  },
);

async function readIdentityMapping(providerSubject: string) {
  return db
    .select({
      appUserId: authIdentities.appUserId,
      identityStatus: authIdentities.status,
      loadedAppUserId: appUsers.id,
      appUserStatus: appUsers.status,
      appUserRole: appUsers.role,
    })
    .from(authIdentities)
    .leftJoin(appUsers, eq(authIdentities.appUserId, appUsers.id))
    .where(
      and(
        eq(authIdentities.provider, AUTH_PROVIDER),
        eq(authIdentities.providerSubject, providerSubject),
      ),
    )
    .limit(2);
}

function notStarted(
  state: "unauthenticated" | "unavailable",
): Parameters<typeof resolveSessionToAppUser>[0] {
  return {
    providerSession: { state },
    identityMapping: { state: "not_requested" },
    appUser: { state: "not_requested" },
  };
}

function authenticated(
  identityMapping: IdentityMappingPortResult,
): Parameters<typeof resolveSessionToAppUser>[0] {
  return {
    providerSession: { state: "authenticated" },
    identityMapping,
    appUser: { state: "not_requested" },
  };
}
