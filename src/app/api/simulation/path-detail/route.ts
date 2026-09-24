import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { isSameOriginAuthRequest, readBoundedAuthBody } from "@/lib/auth/auth-request-validation";
import { simulationPathDetails } from "@/lib/server/simulation-path-details";
import type { SimulationPathHandle } from "@/lib/simulation-path-detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function reply(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex, nofollow" } });
}
function sameOrigin(request: Request) {
  if (isSameOriginAuthRequest(request)) return true;
  // Next's local Node adapter can canonicalize request.url to localhost while
  // the browser uses 127.0.0.1. Compare the HTTP authority, never forwarded-host.
  const host = request.headers.get("host");
  return Boolean(host && request.headers.get("sec-fetch-site") !== "cross-site" && request.headers.get("origin") === `${new URL(request.url).protocol}//${host}`);
}
export async function POST(request: Request) { return processRequest(request); }
export async function DELETE(request: Request) { return processRequest(request, true); }
async function processRequest(request: Request, remove = false) {
  try {
    if (new URL(request.url).search || !sameOrigin(request) || request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply({ error: "invalid_request" }, 400);
    let body;
    try { body = JSON.parse(await readBoundedAuthBody(request) ?? "null"); }
    catch { return reply({ error: "invalid_request" }, 400); }
    if (!body || Object.keys(body).sort().join() !== "handle,pathIndex" || !body.handle || Object.keys(body.handle).sort().join() !== "binding,currency,executionId,expiresAt,model,preview") return reply({ error: "invalid_request" }, 400);
    const h = body.handle as SimulationPathHandle;
    if (typeof h.executionId !== "string" || !/^[0-9a-f-]{36}$/.test(h.executionId) || typeof h.binding !== "string" || !/^[0-9a-f]{64}$/.test(h.binding) || !["KRW", "USD"].includes(h.currency) || !["economic", "bootstrap"].includes(h.model) || typeof h.preview !== "boolean" || !Number.isSafeInteger(h.expiresAt) || !Number.isInteger(body.pathIndex)) return reply({ error: "invalid_request" }, 400);
    let owner: string;
    if (h.preview) {
      if (process.env.NODE_ENV !== "development") return reply({ error: "not_found" }, 404);
      owner = "development-preview";
    } else {
      const session = await resolveCurrentTenantContext();
      if (!session.ok) return reply({ error: "authentication_required" }, 401);
      owner = session.tenantContext.ownerUserId;
    }
    if (remove) {
      const { sharedExecutionOwnerEnabled } = await import("@/lib/simulation-execution-availability");
      if (h.preview || !sharedExecutionOwnerEnabled(process.env, owner)) return reply({ error: "detail_unavailable" }, 503);
      const { deleteSharedExecution } = await import("@/db/queries/simulation-execution-storage");
      return await deleteSharedExecution(owner, h) ? reply({ deleted: true }) : reply({ error: "not_found" }, 404);
    }
    const result = await simulationPathDetails.read(owner, h, body.pathIndex);
    return result.ok ? reply(result.detail) : reply({ error: result.error }, result.status);
  } catch { return reply({ error: "detail_unavailable" }, 503); }
}
