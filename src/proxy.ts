import { NextResponse, type NextRequest } from "next/server";

const DASHBOARD_PASSWORD_ENV_KEYS = [
  "VARDA_APP_PASSWORD",
  "APP_ACCESS_PASSWORD",
] as const;
const DASHBOARD_USER_ENV_KEY = "VARDA_APP_USER";

export function proxy(request: NextRequest) {
  const password = firstConfiguredEnv(DASHBOARD_PASSWORD_ENV_KEYS);

  if (!password) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("Dashboard access is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const expectedUser = process.env[DASHBOARD_USER_ENV_KEY]?.trim() || "varda";
  const presented = parseBasicAuth(request.headers.get("authorization"));

  if (
    presented &&
    safeEqual(presented.username, expectedUser) &&
    safeEqual(presented.password, password)
  ) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="Varda Labs", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: [
    "/",
    "/admin/:path*",
    "/portfolio/:path*",
    "/etfs",
    "/etfs/:path*",
    "/history",
    "/history/:path*",
    "/investment-lab",
    "/investment-lab/:path*",
    "/market",
    "/market/:path*",
    "/simulation",
    "/simulation/:path*",
    "/today",
    "/today/:path*",
  ],
};

function firstConfiguredEnv(keys: readonly string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

function parseBasicAuth(header: string | null) {
  const prefix = "Basic ";
  if (!header?.startsWith(prefix)) return null;

  try {
    const decoded = atob(header.slice(prefix.length).trim());
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return null;
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

function safeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
