import { getPreviewAuthRuntime } from "@/lib/auth/preview-auth-runtime";

export const dynamic = "force-dynamic";

type AuthRouteContext = Readonly<{
  params: Promise<{ path: string[] }>;
}>;

export async function GET(request: Request, context: AuthRouteContext) {
  return dispatchAuthRequest("GET", request, context);
}

export async function POST(request: Request, context: AuthRouteContext) {
  return dispatchAuthRequest("POST", request, context);
}

async function dispatchAuthRequest(
  method: "GET" | "POST",
  request: Request,
  context: AuthRouteContext,
) {
  const runtime = getPreviewAuthRuntime();

  if (runtime.state === "disabled") {
    return new Response("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (runtime.state === "misconfigured") {
    return Response.json(
      { error: "Authentication unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }

  return runtime.auth.handler()[method](request, context);
}
