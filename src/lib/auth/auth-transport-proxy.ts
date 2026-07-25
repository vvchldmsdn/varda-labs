import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { createAuthTransportUpstreamHeaders } from "@/lib/auth/auth-transport-request";
import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";

export async function handleAuthTransportProxy(request: NextRequest) {
  const runtime = getAuthTransportRuntime();

  if (runtime.state === "disabled") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (runtime.state === "misconfigured") {
    return new NextResponse("Authentication transport is unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const upstreamRequest = new NextRequest(request, {
    headers: createAuthTransportUpstreamHeaders(request.headers),
  });

  return runtime.auth.middleware({ loginUrl: "/auth/sign-in" })(
    upstreamRequest,
  );
}
