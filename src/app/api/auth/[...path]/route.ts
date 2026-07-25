import { getPreviewAuthRuntime } from "@/lib/auth/preview-auth-runtime";
import { isPreviewAuthApiRequestAllowed } from "@/lib/auth/preview-auth-policy";

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
  const path = (await context.params).path;
  const socialProvider = await readSocialProvider(request, method, path);

  if (
    !isPreviewAuthApiRequestAllowed({
      method,
      path,
      socialProvider,
    })
  ) {
    return notFoundResponse();
  }

  const runtime = getPreviewAuthRuntime();

  if (runtime.state === "disabled") {
    return notFoundResponse();
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

async function readSocialProvider(
  request: Request,
  method: "GET" | "POST",
  path: readonly string[],
) {
  if (
    method !== "POST" ||
    path.length !== 2 ||
    path[0] !== "sign-in" ||
    path[1] !== "social"
  ) {
    return null;
  }

  try {
    const body: unknown = await request.clone().json();
    if (
      typeof body === "object" &&
      body !== null &&
      "provider" in body &&
      typeof body.provider === "string"
    ) {
      return body.provider;
    }
  } catch {
    return null;
  }

  return null;
}

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
