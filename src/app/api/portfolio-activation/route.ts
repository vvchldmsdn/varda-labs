import { createHash } from "node:crypto";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { createCurrentSessionTenant } from "@/lib/auth/self-service-tenant-onboarding-write";
import { SELF_SERVICE_TENANT_ONBOARDING_POLICY } from "@/lib/auth/self-service-tenant-onboarding";
import { isSameOriginAuthRequest, readBoundedAuthBody } from "@/lib/auth/auth-request-validation";
import { parseQuickDraft } from "@/lib/quick-portfolio";
import { savePortfolioDraft } from "@/db/queries/portfolio-drafts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function response(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
async function identity() {
  const session = await readCurrentSessionSubject();
  if (session.state !== "authenticated") return response({ error: session.state },
    session.state === "unauthenticated" || session.state === "unverified" ? 401 : 503);
  return createHash("sha256").update(`portfolio-activation\0${session.provider}\0${session.providerSubject}`).digest("hex");
}
export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return response({ error: "invalid_request" }, 400);
    const sessionKey = await identity();
    return sessionKey instanceof Response ? sessionKey : response({ sessionKey });
  } catch { return response({ error: "unavailable" }, 503); }
}
export async function POST(request: Request) {
  try {
    if (new URL(request.url).search || !isSameOriginAuthRequest(request) || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
      return response({ error: "invalid_request" }, 400);
    let value;
    try { value = JSON.parse(await readBoundedAuthBody(request) ?? "null"); }
    catch { return response({ error: "invalid_request" }, 400); }
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, "draft") || !Object.hasOwn(value, "sessionKey")) return response({ error: "invalid_request" }, 400);
    const draft = parseQuickDraft(JSON.stringify(value.draft));
    if (!draft) return response({ error: "expired_input" }, 400);
    const sessionKey = await identity();
    if (sessionKey instanceof Response) return sessionKey;
    if (value.sessionKey !== sessionKey) return response({ error: "account_changed" }, 409);
    const resolution = await resolveCurrentTenantContext();
    if (!resolution.ok) {
      if (resolution.failure.code !== "identity_unlinked") return response({ error: resolution.failure.code }, resolution.failure.httpStatus);
      const form = new FormData();
      form.set("confirmation", SELF_SERVICE_TENANT_ONBOARDING_POLICY.confirmationValue);
      const prepared = await createCurrentSessionTenant(form);
      if (prepared.status !== "success" && prepared.status !== "already_ready") return response({ error: "account_unavailable" }, 409);
      // A fresh request re-resolves ownership after identity creation; never reuse
      // a cached unlinked resolution or construct tenant authority on the client.
      return response({ prepared: true, accountCreated: prepared.status === "success" }, 202);
    }
    const saved = await savePortfolioDraft(resolution.tenantContext, draft.id, draft.input);
    if (saved.status === "inactive") return response({ error: "account_unavailable" }, 403);
    if (saved.status === "conflict" || saved.status === "limit") return response({ error: `draft_${saved.status}` }, 409);
    return response({ id: saved.id, created: saved.status === "created" }, saved.status === "created" ? 201 : 200);
  } catch { return response({ error: "unavailable" }, 503); }
}
