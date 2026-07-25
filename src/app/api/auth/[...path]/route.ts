import { createReviewedGoogleSocialSignInRequest } from "@/lib/auth/auth-transport-api-contract";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import { isAuthTransportApiRequestAllowed } from "@/lib/auth/auth-transport-policy";

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
  const isGoogleSocialSignIn =
    method === "POST" &&
    path.length === 2 &&
    path[0] === "sign-in" &&
    path[1] === "social";
  const forwardedRequest = isGoogleSocialSignIn
    ? await createReviewedGoogleSocialSignInRequest(request)
    : request;
  const socialProvider = forwardedRequest && isGoogleSocialSignIn
    ? "google"
    : null;

  if (
    !forwardedRequest ||
    new URL(request.url).search !== "" ||
    !isAuthTransportApiRequestAllowed({
      method,
      path,
      socialProvider,
    })
  ) {
    return notFoundResponse();
  }

  const runtime = getAuthTransportRuntime();

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

  return runtime.auth.handler()[method](forwardedRequest, context);
}

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
