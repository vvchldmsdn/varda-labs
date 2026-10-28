import type {BetaContext} from './navigation';
import {betaReadHref} from './navigation';
import {canonicalBetaReadEpoch} from './read-freshness';
import {domainContext,domainQueryContext,domainQueryValid,type BetaReadPorts} from './read-service';
import {normalizeTradeRecordHint,type TradeRecordHint} from '../trade-record-intent';
export type RemainingKind='ledger'|'plans';
type Params=Record<string,string|string[]|undefined>;
export type RemainingWorkspaceRead={kind:RemainingKind;context:BetaContext;state:'ready'|'unavailable'|'unauthorized';message:string;scopes:{key:string;label:string;detail:string}[];selection:TradeRecordHint;queryKey:string;readReceipt?:string;readEpoch?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowed=new Set(['mode','scope','currency','cashAmountKrw','_betaRead','accountId','assetId','action']);
export function remainingWorkspaceKey(kind:RemainingKind,context:BetaContext,selection:TradeRecordHint={}){return JSON.stringify(['remaining-workspace-v1',kind,context.mode,context.scope,context.currency,selection.accountId,selection.assetId,selection.action]);}
export function remainingWorkspaceQueryKey(kind:RemainingKind,query:string){const search=new URLSearchParams(query),params:Params={};for(const key of ['accountId','assetId','action']){const values=search.getAll(key);if(values.length>1)return 'invalid-remaining-query:'+query;if(values.length===1)params[key]=values[0];}return remainingWorkspaceKey(kind,domainQueryContext(query),normalizeTradeRecordHint(params));}
export function remainingWorkspaceHref(kind:RemainingKind,context:BetaContext,epoch?:string|null,selection:TradeRecordHint={}){const q=new URLSearchParams({mode:'domain',scope:context.scope,currency:context.currency});if(typeof context.cashAmountKrw==='string')q.set('cashAmountKrw',context.cashAmountKrw);const hint=normalizeTradeRecordHint(selection);if(kind==='ledger'){if(hint.accountId)q.set('accountId',hint.accountId);if(hint.accountId&&hint.assetId)q.set('assetId',hint.assetId);if(hint.action)q.set('action',hint.action);}return betaReadHref((kind==='ledger'?'/beta/portfolio/ledger':'/beta/plans')+'?'+q+'#'+(kind==='ledger'?'trade-ledger':'saved-plans'),epoch);}
export async function readRemainingWorkspace(kind:RemainingKind,params:Params,ports:Pick<BetaReadPorts,'session'|'scopes'>):Promise<RemainingWorkspaceRead>{
 const context=domainContext(params),selection=normalizeTradeRecordHint(params);let base:RemainingWorkspaceRead={kind,context,selection,state:'unavailable',message:'로그인과 소유 범위를 확인할 수 없습니다',scopes:[],queryKey:remainingWorkspaceKey(kind,context,selection)};
 if(!domainQueryValid(params)||Object.keys(params).some(key=>!allowed.has(key))||(params._betaRead!==undefined&&!canonicalBetaReadEpoch(params._betaRead))||(['accountId','assetId']as const).some(key=>params[key]!==undefined&&(typeof params[key]!=='string'||!uuid.test(params[key])))||(params.assetId!==undefined&&params.accountId===undefined)||(params.action!==undefined&&!['buy','sell','cost_basis'].includes(params.action as string))||(kind==='plans'&&['accountId','assetId','action'].some(key=>params[key]!==undefined)))return {...base,state:'unauthorized',message:'이동 조건이 올바르지 않습니다. 다른 계좌나 전체 범위로 대체하지 않습니다.'};
 try{const session=await ports.session();if(!session.ok)return {...base,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable'};const catalog=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});if(catalog.state!=='ready')return base;if(catalog.resolution.state!=='resolved')return {...base,state:'unauthorized',message:'허용되지 않은 조회 범위입니다'};
  if(selection.accountId&&!catalog.catalog.scopes.some(s=>s.kind==='account'&&s.key==='account:'+selection.accountId))return {...base,state:'unauthorized',message:'선택한 계좌에 접근할 수 없습니다'};
  base={...base,scopes:catalog.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'소유 범위 전체':s.kind==='account'?'소유 계좌':'소유 분석 범위'}))};
  return {...base,state:'ready',message:kind==='ledger'?'거래·현금 원장 · 기존 기록 처리 경로':'저장된 투자계획 · 기존 계획 처리 경로'};
 }catch{return base;}
}
