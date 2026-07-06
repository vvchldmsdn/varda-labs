import "server-only";

import { NextResponse } from "next/server";

import { isAuthorizedAdminJob } from "@/lib/admin-auth";

export function requireAdminJob(request: Request) {
  if (isAuthorizedAdminJob(request.headers)) return null;
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
