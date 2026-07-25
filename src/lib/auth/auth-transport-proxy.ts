import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { getAuthTransportRuntime } from "@/lib/auth/auth-transport-runtime";

export async function handleAuthTransportProxy(request: NextRequest) {
  const runtime = getAuthTransportRuntime();

  if (runtime.state !== "ready") return NextResponse.next();

  return runtime.auth.middleware({ loginUrl: "/auth/sign-in" })(request);
}
