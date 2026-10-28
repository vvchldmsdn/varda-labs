import type { getReadOnlyTenantHoldings } from '../../db/queries/tenant-holdings';
import { resolveSnapshotCycle } from '../snapshots/market-calendar';
import { adaptHoldings, blankHoldings, type HoldingsRead } from './holding-contract';
import { domainContext, domainQueryValid, type BetaReadPorts } from './read-service';

export type HoldingsPorts = Pick<BetaReadPorts, 'session' | 'scopes' | 'now'> & {
  holdings: typeof getReadOnlyTenantHoldings;
};

export async function readBetaHoldings(
  params: Record<string, string | string[] | undefined>,
  ports: HoldingsPorts,
): Promise<HoldingsRead> {
  const context = domainContext(params);
  let base = blankHoldings(context, 'unavailable', '저장 보유 자료의 소유 범위를 확인할 수 없습니다');
  if (!domainQueryValid(params)) {
    return { ...base, state: 'unauthorized', message: '조회 조건 오류 · 중복·가상·잘못된 범위를 전체 자산으로 대체하지 않습니다' };
  }
  try {
    const session = await ports.session();
    if (!session.ok) {
      return { ...base, state: session.failure.httpStatus === 401 || session.failure.httpStatus === 403 ? 'unauthorized' : 'unavailable', message: '사용자 확인 전 · 저장 보유 자료를 조회하지 않습니다' };
    }
    const catalog = await ports.scopes({ scope: params.scope, tenantContext: session.tenantContext });
    if (catalog.state !== 'ready') return base;
    base = { ...base, scopes: catalog.catalog.scopes.map(scope => ({ key: scope.key, label: scope.label, detail: scope.kind === 'all' ? '소유 범위 전체' : scope.kind === 'account' ? '소유 계좌' : '소유 분석 범위' })) };
    if (catalog.resolution.state !== 'resolved') {
      return { ...base, state: 'unauthorized', message: '허용되지 않은 조회 범위 · 저장 보유 자료를 조회하지 않습니다' };
    }
    const scope = catalog.resolution.scope;
    const serviceDate = resolveSnapshotCycle(ports.now?.() ?? new Date()).snapshotDate;
    base = { ...base, context: { ...context, scope: scope.key }, serviceDate };
    // One admitted holdings query; no dashboard, policy, provider or research read.
    return adaptHoldings(base, await ports.holdings({ tenantContext: session.tenantContext, serviceDate, scope }));
  } catch {
    return base;
  }
}
