import {domainContext,domainQueryValid,type BetaReadPorts} from './read-service';
import type {getReadOnlyTenantSnapshotScopeContext} from '../../db/queries/tenant-snapshot-scopes';
import type {getReadOnlyTenantPortfolioSnapshots} from '../../db/queries/tenant-portfolio-snapshots';
import type {getReadOnlyTenantPositionSnapshots} from '../../db/queries/tenant-position-snapshots';
import {isTenantSnapshotScope} from '../tenant-snapshot-scope';
import {blankSnapshots,snapshotDate,adaptSnapshots,type SnapshotKind,type SnapshotRead} from './snapshot-contract';
export type SnapshotPorts=Pick<BetaReadPorts,'session'> & {scopes:typeof getReadOnlyTenantSnapshotScopeContext;accounts:typeof getReadOnlyTenantPortfolioSnapshots;positions:typeof getReadOnlyTenantPositionSnapshots};
export async function readBetaSnapshots(params:Record<string,string|string[]|undefined>,kind:SnapshotKind,ports:SnapshotPorts):Promise<SnapshotRead>{
 const context=domainContext(params),date=snapshotDate(params.date);
 let base=blankSnapshots(context,kind,typeof date==='string'?date:null,'unavailable','저장 평가의 소유 범위를 확인할 수 없습니다');
 if(!domainQueryValid(params)||date===null||(params.date!==undefined&&date===undefined)||(kind==='positions'&&date===undefined))return {...base,state:'invalid',message:'조회 조건 오류 · 종목 상세는 정확한 저장 날짜가 필요합니다. 빈 날짜·중복·잘못된 범위를 자동 대체하지 않습니다'};
 try{
  const session=await ports.session();
  if(!session.ok)return {...base,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'사용자 확인 전 · 저장 평가 조회하지 않음'};
  const catalog=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});
  if(catalog.state!=='ready')return base;
  base={...base,scopes:catalog.catalog.scopes.filter(isTenantSnapshotScope).map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'모델이 허용한 소유 계좌':'소유 계좌의 저장 평가'}))};
  if(typeof params.scope==='string'&&params.scope.startsWith('portfolio:'))return {...base,state:'unsupported',message:'이 저장 평가 모델은 분석 그룹을 지원하지 않습니다 · 계좌로 자동 대체하지 않음'};
  if(catalog.resolution.state!=='resolved'||!isTenantSnapshotScope(catalog.resolution.scope))return {...base,state:'unauthorized',message:'허용되지 않은 계좌 · 저장 평가 조회하지 않음'};
  const args={tenantContext:session.tenantContext,scope:catalog.resolution.scope,requestedSnapshotDate:date};
  return adaptSnapshots(base,kind==='accounts'?await ports.accounts(args):await ports.positions(args));
 }catch{return base;}
}
