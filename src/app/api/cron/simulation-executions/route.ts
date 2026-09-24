import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import { sharedExecutionCleanupEnabled } from "@/lib/simulation-execution-availability";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (!isAuthorizedAdminJob(request.headers)) return Response.json({ error: "unauthorized" }, { status: 401, headers });
  if (new URL(request.url).search) return Response.json({ error: "invalid_request" }, { status: 400, headers });
  if (!sharedExecutionCleanupEnabled(process.env)) return Response.json({ status: "disabled" }, { status: 409, headers });
  try {
    const { cleanupSimulationExecutions } = await import("@/db/queries/simulation-execution-cleanup");
    return Response.json(await cleanupSimulationExecutions(), { headers });
  } catch { return Response.json({ error: "cleanup_unavailable" }, { status: 503, headers }); }
}
