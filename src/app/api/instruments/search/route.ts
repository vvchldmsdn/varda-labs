import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { searchOnboardingInstruments } from "@/db/queries/onboarding-instrument-search";
import { parseOnboardingInstrumentSearch, type OnboardingInstrumentSearchResult } from "@/lib/onboarding-instrument-search";

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
