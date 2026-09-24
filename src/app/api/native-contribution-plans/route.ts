import { createHash } from "node:crypto";
import { releaseOwnerAllowed } from "@/lib/release-admission";
import { readCurrentSessionSubject } from "@/lib/auth/current-session-subject";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { isSameOriginAuthRequest, readBoundedAuthBody } from "@/lib/auth/auth-request-validation";
import { readNativeContributionContext } from "@/db/queries/native-contribution-context";
import { deleteNativeContributionPlan, listNativeContributionPlans, saveNativeContributionPlan } from "@/db/queries/native-contribution-plans";
import { isNativeContributionPlanId, validNativeContributionRequest } from "@/lib/native-contribution-plan";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
async function authContext() {
  const subject = await readCurrentSessionSubject();
  if (subject.state !== "authenticated") return response({ error: "sign_in_required" }, 401);
  const resolved = await resolveCurrentTenantContext();
  if (!resolved.ok) return response({ error: "account_unavailable" }, resolved.failure.httpStatus);
  return { tenant: resolved.tenantContext, sessionKey: createHash("sha256").update(`native-contribution\0${subject.provider}\0${subject.providerSubject}\0${resolved.tenantContext.ownerUserId}`).digest("hex") };
}
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => !["scope", "currency"].includes(key)) || params.getAll("scope").length !== 1 || params.getAll("currency").length !== 1 || !["KRW", "USD"].includes(params.get("currency")!)) return response({ error: "invalid_request" }, 400);
    const auth = await authContext(); if (auth instanceof Response) return auth;
    const scope = params.get("scope")!;
    const [context, plans] = await Promise.all([readNativeContributionContext(auth.tenant, scope, params.get("currency") as "KRW" | "USD"), listNativeContributionPlans(auth.tenant, scope)]);
    return response({ sessionKey: auth.sessionKey, context, plans, canSave: releaseOwnerAllowed(process.env, "NATIVE_LEDGER", auth.tenant.ownerUserId) });
  } catch { return response({ error: "unavailable" }, 503); }
}
export async function POST(request: Request) {
  try {
    if (new URL(request.url).search || !isSameOriginAuthRequest(request) || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return response({ error: "invalid_request" }, 400);
    let body;
    try { body = JSON.parse(await readBoundedAuthBody(request) ?? "null"); } catch { return response({ error: "invalid_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["sessionKey", "request"].includes(key)) || !validNativeContributionRequest(body.request)) return response({ error: "invalid_request" }, 400);
    const auth = await authContext(); if (auth instanceof Response) return auth;
    if (body.sessionKey !== auth.sessionKey) return response({ error: "account_changed" }, 409);
    if (!releaseOwnerAllowed(process.env, "NATIVE_LEDGER", auth.tenant.ownerUserId)) return response({ error: "temporarily_unavailable" }, 503);
    const result = await saveNativeContributionPlan(auth.tenant, body.request);
    return response(result, result.status === "created" ? 201 : result.status === "existing" ? 200 : 409);
  } catch { return response({ error: "unavailable" }, 503); }
}
export async function DELETE(request: Request) {
  try {
    if (new URL(request.url).search || !isSameOriginAuthRequest(request) || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return response({ error: "invalid_request" }, 400);
    let body;
    try { body = JSON.parse(await readBoundedAuthBody(request) ?? "null"); } catch { return response({ error: "invalid_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["sessionKey", "id"].includes(key)) || !isNativeContributionPlanId(body.id)) return response({ error: "invalid_request" }, 400);
    const auth = await authContext(); if (auth instanceof Response) return auth;
    if (body.sessionKey !== auth.sessionKey) return response({ error: "account_changed" }, 409);
    const deleted = await deleteNativeContributionPlan(auth.tenant, body.id);
    // An already absent owner-scoped ID is a successful retry, with no cross-owner oracle.
    return response({ status: deleted ? "deleted" : "absent", id: body.id });
  } catch { return response({ error: "unavailable" }, 503); }
}
