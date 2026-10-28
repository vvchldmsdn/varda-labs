import type {getSharedManagedHoldings} from '../shared-backend/holdings';
import type {getSharedPortfolioGroupManagementModel} from '../shared-backend/groups';
import type {BetaReadPorts} from './read-service';
import {domainContext,domainQueryValid} from './read-service';
import {canonicalBetaReadEpoch} from './read-freshness';
import {blankOwnedManagement,type ManagementKind,type OwnedManagementRead} from './owned-management-contract';
type Params=Record<string,string|string[]|undefined>;
export type OwnedManagementPorts=Pick<BetaReadPorts,'session'|'scopes'>&{holdings:typeof getSharedManagedHoldings;groups:typeof getSharedPortfolioGroupManagementModel;serviceDate:()=>Promise<string>;aligned:()=>Promise<boolean>};
export async function readOwnedManagement(kind:ManagementKind,params:Params,ports:OwnedManagementPorts):Promise<OwnedManagementRead>{
 const context=domainContext(params);let base=blankOwnedManagement(kind,context,'unavailable','관리 자료를 확인할 수 없습니다');
 if(!domainQueryValid(params)||(params._betaRead!==undefined&&!canonicalBetaReadEpoch(params._betaRead))||['returnUrl','redirect','next','ownerUserId','token','action'].some(k=>params[k]!==undefined))return {...base,state:'unauthorized',message:'조회 조건 오류 · 잘못된 범위를 전체로 대체하지 않습니다'};
 try{
  const session=await ports.session();if(!session.ok)return {...base,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'로그인과 사용자 확인 전 · 관리 자료를 조회하지 않습니다'};
  const catalog=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});if(catalog.state!=='ready')return {...base,message:'소유 조회 범위를 확인할 수 없습니다'};
  base={...base,scopes:catalog.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'소유 범위 전체':s.kind==='account'?'소유 계좌':'소유 분석 범위'}))};
  if(catalog.resolution.state!=='resolved')return {...base,state:'unauthorized',message:'허용되지 않은 범위 · 관리 자료를 조회하지 않습니다'};
  const scope=catalog.resolution.scope,serviceDate=await ports.serviceDate();base={...base,context:{...context,scope:scope.key},serviceDate,allowUnknownAverageCost:await ports.aligned()};
  if(kind==='groups'){
   const model=await ports.groups({serviceDate,tenantContext:session.tenantContext});if(model.state!=='ready')return {...base,message:'자산 그룹 읽기 실패 · 예시로 대체하지 않습니다'};
   return {...base,state:model.groups.length?'ready':'empty',message:'본인 전체 자산 그룹 · 상단 범위는 접근·이동 문맥입니다',groups:model};
  }
  const model=await ports.holdings({serviceDate,scope,tenantContext:session.tenantContext});if(model.state==='unavailable'||model.state==='integrity_error')return {...base,message:'보유 관리 자료 확인 실패 · 다른 평가나 예시로 대체하지 않습니다'};
  return {...base,state:model.state==='partial'?'partial':model.holdings.length?'ready':'empty',excludedHoldingCount:model.excludedHoldingCount,message:model.state==='partial'?'일부 보유 자료 제외 · 확인한 행만 관리합니다':'소유 범위의 보유 기록 · 매매 체결과 별도인 상태 정정·종료·복원',holdings:model.holdings.map(r=>({holdingId:r.holdingId,name:r.name,ticker:r.ticker,accountName:r.accountName,quantity:r.quantity,averageCost:r.averageCost,currency:r.currency,market:r.market,archivedAt:r.archivedAt,updatedAt:r.updatedAt}))};
 }catch{return {...base,message:'관리 자료 조회 실패 · 예시나 다른 사용자 자료로 대체하지 않습니다'};}
}
