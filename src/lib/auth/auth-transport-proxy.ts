import "server-only";

import { NextResponse, type NextRequest } from "next/server";

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

  return runtime.auth.middleware({ loginUrl: "/auth/sign-in" })(request);
}
