import type {BetaReadPorts} from './read-service';
import {domainContext,domainQueryValid} from './read-service';
import {canonicalBetaReadEpoch} from './read-freshness';
import {blankOnboarding,type HoldingOnboardingRead} from './onboarding-contract';
import type {getSharedHoldingOnboardingOptions} from '../shared-backend/holding-onboarding';
type Params=Record<string,string|string[]|undefined>;
export type HoldingOnboardingPorts=Pick<BetaReadPorts,'session'|'scopes'>&{options:typeof getSharedHoldingOnboardingOptions;aligned:()=>Promise<boolean>};
export async function readHoldingOnboarding(params:Params,ports:HoldingOnboardingPorts):Promise<HoldingOnboardingRead>{
 const context=domainContext(params);let base=blankOnboarding(context,'unavailable','등록 조건을 읽지 못했습니다');
 if(!domainQueryValid(params)||(params._betaRead!==undefined&&!canonicalBetaReadEpoch(params._betaRead))||['returnUrl','redirect','next','url','ownerUserId','token','action','accountId','instrumentId'].some(k=>params[k]!==undefined))return {...base,state:'unauthorized',message:'조회 조건 오류 · 다른 계좌로 대체하지 않습니다'};
 try{
  const session=await ports.session();if(!session.ok)return {...base,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'로그인과 사용자 확인 전 · 등록 조건을 조회하지 않습니다'};
  const catalog=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});if(catalog.state!=='ready')return base;
  base={...base,scopes:catalog.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'소유 범위 전체':s.kind==='account'?'소유 계좌':'소유 분석 범위'}))};
  if(catalog.resolution.state!=='resolved')return {...base,state:'unauthorized',message:'허용되지 않은 범위 · 등록 조건을 조회하지 않습니다'};
  base={...base,context:{...context,scope:catalog.resolution.scope.key},allowUnknownAverageCost:await ports.aligned()};
  const options=await ports.options(session.tenantContext);if(options.state!=='ready')return {...base,message:'계좌·그룹 조회 실패 · 예시로 대체하지 않습니다'};
  // The original query owns admission. Only its public form fields cross the boundary.
  const publicOptions={state:'ready' as const,accounts:options.accounts.map(a=>({id:a.id,code:a.code,name:a.name,accountType:a.accountType})),portfolioGroups:options.portfolioGroups.map(g=>({id:g.id,name:g.name}))};
  return {...base,state:publicOptions.accounts.length?'ready':'empty',message:publicOptions.accounts.length?'기존 보유 상태 등록 · 매수 체결 기록과 별도입니다':'등록 가능한 소유 계좌가 없습니다',options:publicOptions};
 }catch{return {...base,message:'등록 조건 조회 실패 · 다른 사용자 자료로 대체하지 않습니다'};}
}
