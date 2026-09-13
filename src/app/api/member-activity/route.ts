import { recordMemberActivity } from "@/db/queries/member-activity";
import { parseActivityBody } from "@/lib/member-activity";
import { isSameOriginAuthRequest, readBoundedAuthBody } from "@/lib/auth/auth-request-validation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };
  if (new URL(request.url).search || !isSameOriginAuthRequest(request) || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return new Response(null, { status: 400, headers });
  let feature;
  try { feature = parseActivityBody(JSON.parse(await readBoundedAuthBody(request) ?? "null")); } catch { return new Response(null, { status: 400, headers }); }
  if (!feature) return new Response(null, { status: 400, headers });
  try { await recordMemberActivity(feature); return new Response(null, { status: 204, headers }); }
  catch { return new Response(null, { status: 503, headers }); }
}
