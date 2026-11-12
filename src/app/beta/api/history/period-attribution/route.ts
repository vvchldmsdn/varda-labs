import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { displayBindingForScopes } from "@/lib/cairn-v2/display-session";
import { validateAttributionRange } from "@/lib/cairn-v2/period-attribution";
import { readPeriodAttribution } from "@/lib/cairn-v2/period-attribution-read";
import { requireBetaFixtureAccess } from "@/lib/cairn-v2/server-access";
import { currentKstDate } from "@/lib/current-kst-date";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bindingHeader = "X-Cairn-Display-Binding";
function reply(body: object, status: number, binding?: string) {
  const headers = new Headers({ "Cache-Control": "private, no-store", Vary: "Cookie", "X-Robots-Tag": "noindex, nofollow" });
  if (binding) headers.set(bindingHeader, binding);
  return Response.json(body, { status, headers });
}

export async function GET(request: Request) {
  await requireBetaFixtureAccess();
  const query = new URL(request.url).searchParams;
  const keys = ["scope", "start", "end"];
  const scope = query.get("scope");
  const range = { start: query.get("start") ?? "", end: query.get("end") ?? "" };
  if (query.size !== keys.length || keys.some(key => !query.has(key)) || !scope ||
      !validateAttributionRange(range, currentKstDate(new Date()))) {
    return reply({ error: "invalid_request" }, 400);
  }
  try {
    const session = await resolveCurrentTenantContext();
    if (!session.ok) return reply({ error: "session_unavailable" }, session.failure.httpStatus);
    const { tenantContext } = session;
    const context = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext, scope });
    if (context.state !== "ready") return reply({ error: "scope_unavailable" }, 503);
    if (context.resolution.state !== "resolved" || context.resolution.scope.key !== scope) {
      return reply({ error: "scope_unavailable" }, 403);
    }
    // The result must still belong to the same session and catalog as the visible history.
    const binding = displayBindingForScopes(tenantContext, context.catalog);
    if (request.headers.get(bindingHeader) !== binding) return reply({ error: "session_changed" }, 409);
    if (context.resolution.scope.kind === "portfolio_group") return reply({ error: "select_account" }, 422);
    const result = await readPeriodAttribution({ tenantContext, scope: context.resolution.scope, range });
    return reply(result, 200, binding);
  } catch {
    return reply({ error: "history_unavailable" }, 503);
  }
}
