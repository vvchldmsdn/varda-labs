import { effectSession } from '@/lib/auth/contribution-effect-session';
import { isSameOriginAuthRequest, readBoundedAuthBody } from '@/lib/auth/auth-request-validation';
import { releaseOwnerAllowed } from '@/lib/release-admission';
import { saveContributionEffect, linkContributionEffect } from '@/db/queries/contribution-effects';
import { isNativeContributionPlanId as uuid } from '@/lib/native-contribution-plan';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const response = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
async function mutate(request: Request, linking: boolean) {
  try {
    if (new URL(request.url).search || !isSameOriginAuthRequest(request) || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return response({ reason: 'invalid_request' }, 400);
    const body = JSON.parse(await readBoundedAuthBody(request) ?? 'null');
    const allowed = linking ? ['sessionKey','id','accountId','revision','tradeIds'] : ['sessionKey','id','accountId','amount','currency','evidenceVersion'];
    if (!body || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key)) || !uuid(body.id) || !uuid(body.accountId)) return response({ reason: 'invalid_request' }, 400);
    if (linking ? !Number.isSafeInteger(body.revision) || body.revision < 0 || !Array.isArray(body.tradeIds) || body.tradeIds.length > 100 || body.tradeIds.some((id: unknown) => !uuid(id)) || new Set(body.tradeIds).size !== body.tradeIds.length
      : typeof body.amount !== 'string' || !/^\d{1,12}(\.\d{1,2})?$/.test(body.amount) || !['KRW','USD'].includes(body.currency) || !/^[a-f0-9]{64}$/.test(body.evidenceVersion ?? '')) return response({ reason: 'invalid_request' }, 400);
    const auth = await effectSession();
    if (!auth) return response({ reason: 'sign_in_required' }, 401);
    if (body.sessionKey !== auth.key) return response({ reason: 'account_changed' }, 409);
    if (!releaseOwnerAllowed(process.env, 'NATIVE_LEDGER', auth.tenant.ownerUserId)) return response({ reason: 'temporarily_unavailable' }, 503);
    const result = linking ? await linkContributionEffect(auth.tenant, body) : await saveContributionEffect(auth.tenant, body);
    return response(result, result.status === 'blocked' ? 409 : result.status === 'created' ? 201 : 200);
  } catch { return response({ reason: 'unavailable' }, 503); }
}
export const POST = (request: Request) => mutate(request, false);
export const PATCH = (request: Request) => mutate(request, true);
