import { domainContext, domainQueryValid, type BetaReadPorts } from './read-service';
import { blankAnalysis, adaptRisk, adaptDirect, type AnalysisRead } from './analysis-contract';
import type { getReadOnlyTenantPortfolioRiskForScope } from '../../db/queries/portfolio-risk';
import { resolveSnapshotCycle } from '../snapshots/market-calendar.ts';
export type AnalysisPorts = Pick<BetaReadPorts,'session'|'scopes'|'structure'|'now'> & {risk: typeof getReadOnlyTenantPortfolioRiskForScope};
export async function readBetaAnalysis(params: Record<string,string|string[]|undefined>,ports:AnalysisPorts):Promise<AnalysisRead> {
 const context=domainContext(params);
 const result=blankAnalysis(context,'unavailable','분석 조회 실패 · 기존 홈 읽기와 별개');
 if(!domainQueryValid(params) || (params.analysis !== undefined && params.analysis !== 'risk' && params.analysis !== 'holdings') || (params.window !== undefined && !['30','90','252'].includes(typeof params.window === 'string' ? params.window : ''))) return {...result,state:'unauthorized',message:'분석 조건이 올바르지 않습니다 · 중복/지원 외 입력'};
 try {
  const session=await ports.session();
  if(!session.ok) return {...result,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'사용자 확인 전 · 분석 조회하지 않음'};
  const catalog=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});
  if(catalog.state !== 'ready') return result;
  result.scopes=catalog.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'소유 범위 전체':s.kind==='account'?'소유 계좌':'소유 분석 범위'}));
  if(catalog.resolution.state !== 'resolved') return {...result,state:'unauthorized',message:'허용되지 않은 범위 · 분석 조회하지 않음'};
  const now=ports.now?.()??new Date(),serviceDate=resolveSnapshotCycle(now).snapshotDate;
  const args={scope:catalog.resolution.scope,tenantContext:session.tenantContext,serviceDate,analysisScopes:catalog.catalog.scopes};
  result.context={...context,scope:args.scope.key}; result.serviceDate=serviceDate;
  // Exactly one requested analysis; never called from the home/base read service.
  return {...result,...(context.analysis==='holdings' ? adaptDirect(await ports.structure(args)) : adaptRisk(await ports.risk({...args,now,window:params.window})))};
 } catch {return result;}
}
