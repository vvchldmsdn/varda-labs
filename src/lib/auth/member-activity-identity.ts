import "server-only";
import { cache } from "react";
import { readCurrentSessionSubject } from "./current-session-subject";
import { resolveCurrentTenantContext } from "./current-tenant-context";
import { getAuthTransportRuntime } from "./auth-transport-runtime";

const ADMIN_EMAIL = "vvchldmsdn@gmail.com";
export type ActivityIdentity = { ownerUserId: string; name: string | null; email: string | null; isAdmin: boolean };
export const readActivityIdentity = cache(async (): Promise<ActivityIdentity | null> => {
  const session = await readCurrentSessionSubject();
  if (session.state !== "authenticated") return null;
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) return null;
  if (session.provider !== "neon_auth") return { ownerUserId: resolution.tenantContext.ownerUserId, name: null, email: null, isAdmin: false };
  const runtime = getAuthTransportRuntime();
  if (runtime.state !== "ready") return null;
  const result = await runtime.auth.getSession();
  const user = result.data?.user;
  if (result.error || !user || user.id !== session.providerSubject || user.emailVerified !== true) return null;
  const email = typeof user.email === "string" ? user.email.trim().toLowerCase().slice(0, 254) : null;
  const name = typeof user.name === "string" ? user.name.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || null : null;
  return { ownerUserId: resolution.tenantContext.ownerUserId, name, email, isAdmin: email === ADMIN_EMAIL };
});
export async function isActivityAdmin() {
  try { return (await readActivityIdentity())?.isAdmin === true; } catch { return false; }
}
