import type {BetaReadPorts} from './read-service';
import {domainContext,domainQueryValid} from './read-service';
import type {getSharedPortfolioTargetPolicyModel,getSharedTargetServiceDate} from '../shared-backend/target-policy';
import {canonicalBetaReadEpoch} from './read-freshness';
import {adaptTargetEditor,blankTargetEditor,type TargetEditorRead} from './target-editor-contract';
export type TargetEditorPorts=Pick<BetaReadPorts,'session'|'scopes'>&{model:typeof getSharedPortfolioTargetPolicyModel;serviceDate:typeof getSharedTargetServiceDate};
export async function readTargetEditor(params:Record<string,string|string[]|undefined>,ports:TargetEditorPorts):Promise<TargetEditorRead>{
 let base=blankTargetEditor(domainContext(params),'unavailable','목표 자료를 확인할 수 없습니다');
 if(!domainQueryValid(params)||(params._betaRead!==undefined&&!canonicalBetaReadEpoch(params._betaRead))||['returnUrl','redirect','next','ownerUserId','token','action','mutation','q','candidates','removed','approvalRevision'].some(k=>params[k]!==undefined))return {...base,state:'unauthorized',message:'조회 조건 오류 · 잘못된 범위를 전체로 대체하지 않습니다'};
 try{
 const session=await ports.session();if(!session.ok)return {...base,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'로그인과 사용자 확인 전 · 목표 자료를 조회하지 않습니다'};
 const catalog=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});if(catalog.state!=='ready')return base;
 if(catalog.resolution.state!=='resolved')return {...base,state:'unauthorized',message:'허용되지 않은 범위 · 목표 자료를 조회하지 않습니다'};
 const scope=catalog.resolution.scope; base={...base,context:{...base.context,scope:scope.key},scopes:catalog.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'소유 범위 전체':s.kind==='account'?'소유 계좌':'소유 분석 범위'}))};
 const serviceDate=await ports.serviceDate();return adaptTargetEditor(await ports.model({scope,serviceDate,tenantContext:session.tenantContext}),base);
 }catch{return {...base,state:'unavailable',message:'목표 자료 조회 실패 · 이전 승인본이나 예시로 대체하지 않습니다'};}
}
