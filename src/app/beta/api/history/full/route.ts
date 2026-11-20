import { randomUUID } from 'node:crypto';
import { resolveCurrentTenantContext } from '@/lib/auth/current-tenant-context';
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from '@/db/queries/portfolio-analysis-scopes';
import { readRecoveredReturnCurve } from '@/db/queries/period-return-recovery';
import { displayBindingForScopes } from '@/lib/cairn-v2/display-session';
import { getBetaHistoryRead } from '@/lib/cairn-v2/history-read';
import { canonicalBetaReadEpoch } from '@/lib/cairn-v2/read-freshness';
import { requireBetaFixtureAccess } from '@/lib/cairn-v2/server-access';
import { HISTORY_BINDING_HEADER } from '@/lib/cairn-v2/home-history-read';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function reply(body: object, status: number, binding?: string) {
  const headers = new Headers({ 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Robots-Tag': 'noindex, nofollow' });
  if (binding) headers.set(HISTORY_BINDING_HEADER, binding);
  return Response.json(body, { status, headers });
}
export async function GET(request: Request) {
  await requireBetaFixtureAccess();
  const query = new URL(request.url).searchParams;
  const scope = query.get('scope'), currency = query.get('currency'), epoch = query.get('_betaRead');
  if (!scope || scope.length > 200 || scope !== scope.trim() || !['KRW', 'USD'].includes(currency ?? '') ||
    [...query.keys()].some(key => !['scope', 'currency', '_betaRead'].includes(key) || query.getAll(key).length !== 1) ||
    epoch !== null && !canonicalBetaReadEpoch(epoch)) return reply({ error: 'invalid_request' }, 400);
  try {
    const session = await resolveCurrentTenantContext();
    if (!session.ok) return reply({ error: 'session_unavailable' }, session.failure.httpStatus);
    const { tenantContext } = session;
    const context = await getReadOnlyTenantPortfolioAnalysisScopeContext({ tenantContext, scope });
    if (context.state !== 'ready') return reply({ error: 'scope_unavailable' }, 503);
    if (context.resolution.state !== 'resolved' || context.resolution.scope.key !== scope) return reply({ error: 'scope_unavailable' }, 403);
    const binding = displayBindingForScopes(tenantContext, context.catalog);
    if (request.headers.get(HISTORY_BINDING_HEADER) !== binding) return reply({ error: 'session_changed' }, 409);
    const selected = context.resolution.scope;
    const [history, recoveredReturn] = await Promise.all([
      getBetaHistoryRead({ tenantContext, scope: selected, analysisScopes: context.catalog.scopes }),
      selected.kind === 'account' ? readRecoveredReturnCurve(tenantContext, selected.accountId) : Promise.resolve(null),
    ]);
    if (history.readStatus === 'unavailable') return reply({ error: 'history_unavailable' }, 503);
    return reply({ scope, currency, displayBinding: binding, readReceipt: randomUUID(), readEpoch: epoch ?? undefined,
      history: { ...history, recoveredReturn } }, 200, binding);
  } catch { return reply({ error: 'history_unavailable' }, 503); }
}
