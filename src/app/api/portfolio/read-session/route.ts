import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { displaySessionBinding } from "@/lib/cairn-v2/display-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export async function GET(request: Request) {
  if (new URL(request.url).search) return Response.json({ status: "invalid" }, { status: 400, headers });
  try {
    const resolution = await resolveCurrentTenantContext();
    if (!resolution.ok) return Response.json({ status: "unavailable" }, { status: resolution.failure.httpStatus, headers });
    const binding = await displaySessionBinding(resolution.tenantContext);
    return binding ? Response.json({ binding }, { headers }) : Response.json({ status: "unavailable" }, { status: 503, headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
