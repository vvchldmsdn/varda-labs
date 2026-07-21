import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { getPreviewAuthRuntime } from "@/lib/auth/preview-auth-runtime";

export async function handlePreviewAuthProxy(request: NextRequest) {
  const runtime = getPreviewAuthRuntime();

  if (runtime.state !== "ready") return NextResponse.next();

  return runtime.auth.middleware({ loginUrl: "/auth/sign-in" })(request);
}
