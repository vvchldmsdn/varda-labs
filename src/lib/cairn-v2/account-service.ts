import type { getReadOnlyTenantAccountManagementModel } from '../../db/queries/account-management';
import { resolveSnapshotCycle } from '../snapshots/market-calendar';
import { adaptAccounts, blankAccounts, type AccountsRead } from './account-contract';
import { domainContext, domainQueryValid, type BetaReadPorts } from './read-service';

export type AccountsPorts = Pick<BetaReadPorts, 'session' | 'scopes' | 'now'> & {
  accounts: typeof getReadOnlyTenantAccountManagementModel;
};

export async function readBetaAccounts(
  params: Record<string, string | string[] | undefined>,
  ports: AccountsPorts,
): Promise<AccountsRead> {
  const context = domainContext(params);
  let base = blankAccounts(context, 'unavailable', '계좌 현황의 소유 범위를 확인할 수 없습니다');
  if (!domainQueryValid(params)) {
    return { ...base, state: 'unauthorized', message: '조회 조건 오류 · 잘못된 범위를 전체 자산으로 대체하지 않습니다' };
  }
  try {
    const session = await ports.session();
    if (!session.ok) {
      return { ...base, state: session.failure.httpStatus === 401 || session.failure.httpStatus === 403 ? 'unauthorized' : 'unavailable', message: '사용자 확인 전 · 계좌 현황을 조회하지 않습니다' };
    }
    const admitted = await ports.scopes({ scope: params.scope, tenantContext: session.tenantContext });
    if (admitted.state !== 'ready') return base;
    base = { ...base, scopes: admitted.catalog.scopes.map(scope => ({ key: scope.key, label: scope.label, detail: scope.kind === 'all' ? '소유 범위 전체' : scope.kind === 'account' ? '소유 계좌' : '소유 분석 범위' })) };
    if (admitted.resolution.state !== 'resolved') {
      return { ...base, state: 'unauthorized', message: '허용되지 않은 조회 범위 · 계좌 현황을 조회하지 않습니다' };
    }
    const serviceDate = resolveSnapshotCycle(ports.now?.() ?? new Date()).snapshotDate;
    base = { ...base, context: { ...context, scope: admitted.resolution.scope.key }, serviceDate };
    // A single existing owner-wide account model call after session/scope admission.
    // No holdings valuation, policy, provider, dashboard or research read is added.
    return adaptAccounts(base, await ports.accounts({ serviceDate, tenantContext: session.tenantContext }), admitted.catalog.scopes);
  } catch {
    return base;
  }
}
