import { handleNaverAuthRequest } from "@/lib/auth/naver-auth-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };

export async function GET(request: Request, context: Context) {
  return handleNaverAuthRequest(request, (await context.params).path);
}

export async function POST(request: Request, context: Context) {
  return handleNaverAuthRequest(request, (await context.params).path);
}
