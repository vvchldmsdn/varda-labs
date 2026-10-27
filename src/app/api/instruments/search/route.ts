import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { searchOnboardingInstruments } from "@/db/queries/onboarding-instrument-search";
import { parseOnboardingInstrumentSearch, type OnboardingInstrumentSearchResult } from "@/lib/onboarding-instrument-search";
import { isSameOriginAuthRequest, readBoundedAuthBody } from "@/lib/auth/auth-request-validation";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const response = (body: OnboardingInstrumentSearchResult, status = 200) => Response.json(body, { status, headers });

export async function GET(request: Request) {
  try {
    const resolution = await resolveCurrentTenantContext();
    if (!resolution.ok) return response({ status: resolution.failure.httpStatus >= 500 ? "unavailable" : "unauthorized", instruments: [] }, resolution.failure.httpStatus);
    const params = new URL(request.url).searchParams;
    const query = params.getAll("q").length === 1 ? parseOnboardingInstrumentSearch(params.get("q")) : null;
    if (!query) return response({ status: "invalid", instruments: [] }, 400);
    const instruments = await searchOnboardingInstruments(query);
    return response({ status: "ready", instruments });
  } catch {
    return response({ status: "unavailable", instruments: [] }, 503);
  }
}

/** Plan-derived search text stays in the request body, never in URL/access logs. */
export async function POST(request: Request) {
  try {
    if (!isSameOriginAuthRequest(request)) return response({ status: "unauthorized", instruments: [] }, 403);
    const resolution = await resolveCurrentTenantContext();
    if (!resolution.ok) return response({ status: resolution.failure.httpStatus >= 500 ? "unavailable" : "unauthorized", instruments: [] }, resolution.failure.httpStatus);
    if (new URL(request.url).search || request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return response({ status: "invalid", instruments: [] }, 400);
    const raw = await readBoundedAuthBody(request);
    let body: unknown;
    try { body = raw === null ? null : JSON.parse(raw); } catch { return response({ status: "invalid", instruments: [] }, 400); }
    const query = body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 1 && "q" in body ? parseOnboardingInstrumentSearch(body.q) : null;
    if (!query) return response({ status: "invalid", instruments: [] }, 400);
    return response({ status: "ready", instruments: await searchOnboardingInstruments(query) });
  } catch {
    return response({ status: "unavailable", instruments: [] }, 503);
  }
}
