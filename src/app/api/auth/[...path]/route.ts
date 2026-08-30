import { createReviewedAuthRequest } from "@/lib/auth/auth-transport-api-contract";
import { isEmailPasswordEnabled, isGitHubAuthEnabled } from "@/lib/auth/auth-methods";
import { createAuthTransportUpstreamRequest } from "@/lib/auth/auth-transport-request";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";
import { isAuthTransportApiRequestAllowed } from "@/lib/auth/auth-transport-policy";
import { expireNaverSessionCookies } from "@/lib/auth/naver-auth-runtime";

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
  const reviewed = await createReviewedAuthRequest(request, path);
  const forwardedRequest = reviewed?.request;

  if (
    !forwardedRequest ||
    new URL(request.url).search !== "" ||
    !isAuthTransportApiRequestAllowed({
      method,
      path,
      socialProvider: reviewed?.socialProvider,
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

  if (
    (reviewed?.kind === "email" && !isEmailPasswordEnabled({ VARDA_AUTH_EMAIL_PASSWORD_ENABLED: process.env.VARDA_AUTH_EMAIL_PASSWORD_ENABLED })) ||
    (reviewed?.socialProvider === "github" && !isGitHubAuthEnabled({ VARDA_AUTH_GITHUB_ENABLED: process.env.VARDA_AUTH_GITHUB_ENABLED }))
  ) {
    return Response.json({ code: "AUTH_METHOD_UNAVAILABLE" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const upstreamRequest =
    createAuthTransportUpstreamRequest(forwardedRequest);

  const response = await runtime.auth.handler()[method](upstreamRequest, context);
  return reviewed?.kind === "sign-out" && response.ok
    ? expireNaverSessionCookies(request, response)
    : response;
}

function notFoundResponse() {
  return new Response("Not found", {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
}
