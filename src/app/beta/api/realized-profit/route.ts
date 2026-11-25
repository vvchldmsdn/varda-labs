import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { displayBindingForScopes } from "@/lib/cairn-v2/display-session";
import { requireBetaFixtureAccess } from "@/lib/cairn-v2/server-access";
import { readBetaRealizedProfit } from "@/lib/cairn-v2/realized-profit-read";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const bindingHeader = "X-Cairn-Display-Binding";

function reply(body:object,status:number,binding?:string) {
  const headers = new Headers({"Cache-Control":"private, no-store",Vary:"Cookie","X-Robots-Tag":"noindex, nofollow"});
  if (binding) headers.set(bindingHeader,binding);
  return Response.json(body,{status,headers});
}

export async function GET(request:Request) {
  await requireBetaFixtureAccess();
  const query = new URL(request.url).searchParams;
  const scope = query.get("scope");
  if (query.size!==1 || !scope || scope.trim()!==scope) return reply({error:"invalid_request"},400);
  try {
    const session = await resolveCurrentTenantContext();
    if (!session.ok) return reply({error:"session_unavailable"},session.failure.httpStatus);
    const {tenantContext} = session;
    const context = await getReadOnlyTenantPortfolioAnalysisScopeContext({tenantContext,scope});
    if (context.state!=="ready") return reply({error:"scope_unavailable"},503);
    if (context.resolution.state!=="resolved" || context.resolution.scope.key!==scope) return reply({error:"scope_unavailable"},403);
    const binding = displayBindingForScopes(tenantContext,context.catalog);
    if (request.headers.get(bindingHeader)!==binding) return reply({error:"session_changed"},409);
    return reply(await readBetaRealizedProfit(tenantContext,context.resolution.scope),200,binding);
  } catch {
    return reply({error:"realized_profit_unavailable"},503);
  }
}
