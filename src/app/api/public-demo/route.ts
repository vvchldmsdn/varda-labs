import { buildPublicProductDemo, resolvePublicDemoQuery } from "@/lib/public-product-demo";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const selection = resolvePublicDemoQuery(new URL(request.url).searchParams);
  if (!selection) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    return Response.json(buildPublicProductDemo(selection.view, selection.horizon), {
      headers: { "Cache-Control": "public, max-age=3600", "X-Robots-Tag": "noindex, nofollow" },
    });
  } catch {
    return Response.json({ error: "sample_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
