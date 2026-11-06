import { deleteInvestmentPlan, listInvestmentPlans, saveInvestmentPlan } from "@/db/queries/investment-plans";
import { savedPlanSession } from "@/lib/shared-backend/saved-plan-session";
import { isSameOriginAuthRequest, readBoundedAuthBody } from "@/lib/auth/auth-request-validation";
import { isPlanId, validatePlan } from "@/lib/investment-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
async function session(request: Request, mutation = false) {
  const result = await savedPlanSession();
  if (!result.ok) return response({ error: result.error }, result.status);
  if (mutation && request.headers.get("X-Cairn-Plan-Session") !== result.key) return response({ error: "account_changed" }, 409);
  return result;
}
async function body(request: Request, keys: string[]) {
  if (new URL(request.url).search || !isSameOriginAuthRequest(request) || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return null;
  const raw = await readBoundedAuthBody(request);
  try {
    const value = JSON.parse(raw ?? "null");
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || !keys.every(key => Object.hasOwn(value, key))) return null;
    return value;
  } catch { return null; }
}

export async function GET(request: Request) {
  try {
    if (new URL(request.url).search) return response({ error: "invalid_request" }, 400);
    const auth = await session(request);
    if (auth instanceof Response) return auth;
    return response({ sessionKey: auth.key, plans: await listInvestmentPlans(auth.tenant) });
  } catch { return response({ error: "service_unavailable" }, 503); }
}

export async function POST(request: Request) {
  try {
    const value = await body(request, ["id", "input"]);
    if (!value || !isPlanId(value.id)) return response({ error: "invalid_request" }, 400);
    const parsed = validatePlan(value.input);
    if (!parsed.ok) return response({ error: "invalid_input" }, 400);
    const auth = await session(request, true);
    if (auth instanceof Response) return auth;
    const result = await saveInvestmentPlan(auth.tenant, value.id, parsed.input);
    if (result.status === "inactive") return response({ error: "app_user_not_active" }, 403);
    if (result.status === "conflict" || result.status === "limit") return response({ error: `plan_${result.status}` }, 409);
    return response({ id: result.id, created: result.status === "created" }, result.status === "created" ? 201 : 200);
  } catch { return response({ error: "service_unavailable" }, 503); }
}

export async function DELETE(request: Request) {
  try {
    const value = await body(request, ["id"]);
    if (!value || !isPlanId(value.id)) return response({ error: "invalid_request" }, 400);
    const auth = await session(request, true);
    if (auth instanceof Response) return auth;
    if (!await deleteInvestmentPlan(auth.tenant, value.id)) return response({ error: "plan_not_found" }, 404);
    return response({ deleted: true });
  } catch { return response({ error: "service_unavailable" }, 503); }
}
