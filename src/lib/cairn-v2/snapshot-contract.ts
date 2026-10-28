import type {BetaContext} from './navigation';
import {betaHref,betaReadHref} from './navigation';
import type {TenantPortfolioSnapshotReadResult} from '../tenant-portfolio-snapshot-contract';
import type {TenantPositionSnapshotReadResult} from '../tenant-position-snapshot-read-model';
import type {TenantPortfolioSnapshotQueryResult} from '../../db/queries/tenant-portfolio-snapshots';
import type {TenantPositionSnapshotQueryResult} from '../../db/queries/tenant-position-snapshots';
import {parseTenantSnapshotDateQuery} from '../tenant-snapshot-date-query';
import {parseHistoryReturn,type HistorySelection} from './history-return';
export type SnapshotKind='accounts'|'positions';
export type AccountSnapshotModel=Omit<Extract<TenantPortfolioSnapshotReadResult,{state:'ready'|'partial'}>,'scope'>;
export type PositionSnapshotModel=Omit<Extract<TenantPositionSnapshotReadResult,{state:'ready'|'partial'}>,'scope'>;
export type SnapshotRead={
 kind:SnapshotKind;context:BetaContext;requestedDate:string|null;date:string|null;
 state:'ready'|'partial'|'empty'|'unavailable'|'unauthorized'|'unsupported'|'invalid'|'loading';
 message:string;reason?:string;expectedAccounts:readonly string[];
 accounts:AccountSnapshotModel|null;positions:PositionSnapshotModel|null;
 scopes:{key:string;label:string;detail:string}[];
 queryKey?:string;readReceipt?:string;readEpoch?:string;readAt?:string;
};
export {parseTenantSnapshotDateQuery as snapshotDate};
export function snapshotKey(context:BetaContext,date:unknown,kind:SnapshotKind){return JSON.stringify([context.mode,context.scope,context.currency,date,kind]);}
export function blankSnapshots(context:BetaContext,kind:SnapshotKind,date:string|null,state:SnapshotRead['state'],message:string):SnapshotRead{return {context,kind,requestedDate:date,date,state,message,expectedAccounts:[],accounts:null,positions:null,scopes:[]};}
export function adaptSnapshots(base:SnapshotRead,result:TenantPortfolioSnapshotQueryResult|TenantPositionSnapshotQueryResult):SnapshotRead{
 if(result.state==='unavailable')return {...base,state:'unavailable',message:'저장 평가 읽기 실패 · 현재 평가와 별개의 조회입니다'};
 if(result.state==='invalid_request')return {...base,state:'invalid',message:'저장 날짜가 올바르지 않습니다 · 다른 날짜로 대체하지 않습니다'};
 if(result.state==='integrity_error')return {...base,state:'unavailable',reason:result.reason,message:'저장 평가 관계·출처 검증 실패 · 합계를 표시하지 않습니다'};
 if(result.state==='no_data')return {...base,date:result.snapshotDate,state:'empty',expectedAccounts:result.expectedAccounts,message:result.snapshotDate?result.snapshotDate+'의 저장 기록 없음 · 최신 날짜로 대체하지 않음':'허용된 범위에 저장 기록 없음'};
 // The original projector has already removed internal row/owner/asset IDs.
 // Remove the server scope object as well; no values or financial formulas change.
 const {scope,...model}=result;void scope;
 return {...base,date:result.snapshotDate,state:result.state,expectedAccounts:result.expectedAccounts,message:result.state==='partial'?'부분 저장 평가 · 누락·제외·불완전 근거를 확인하세요':'선택 저장일의 평가 · 현재 시세 평가가 아닙니다',accounts:'snapshots' in model?model:null,positions:'positions' in model?model:null};
}
// Decimal strings remain strings: no Number/Intl conversion, rounding or zero fill.
export function snapshotDecimal(value:string|number|null|undefined):string{
 if(value===null||value===undefined)return '—';
 const text=String(value);if(!/^-?\d+(\.\d+)?$/.test(text))return text;
 const [integer,fraction]=text.split('.');return integer.replace(/\B(?=(\d{3})+(?!\d))/g,',')+(fraction===undefined?'':'.'+fraction);
}
export function snapshotHref(context:BetaContext,date:string|string[]|undefined,epoch?:string|null,kind:SnapshotKind='accounts'){
 const url=new URL(betaHref('/beta/history',context),'https://beta.invalid');url.pathname=kind==='accounts'?'/beta/history/snapshots':'/beta/history/position-snapshots';
 if(date!==undefined)for(const value of Array.isArray(date)?date:[date])url.searchParams.append('date',value);
 return betaReadHref(url.pathname+url.search+'#stored-valuations',epoch);
}
function carryReturn(href:string,context:BetaContext,search:URLSearchParams){
 const hint=parseHistoryReturn(search,context),url=new URL(href,'https://beta.invalid');
 if(hint==='invalid')url.searchParams.set('_historyReturn','invalid');
 else if(hint){for(const [key,value]of Object.entries({_historyDate:hint.date,_historyPeriod:hint.period,_historyMetric:hint.metric,_historyScope:hint.scope,_historyCurrency:hint.currency,_historyReturn:hint.kind}))url.searchParams.set(key,value);if(hint.dateBasis)url.searchParams.set('_historyDateBasis',hint.dateBasis);}
 return url.pathname+url.search+url.hash;
}
export function continueSnapshotHref(context:BetaContext,date:string|string[]|undefined,epoch:string|null|undefined,search:URLSearchParams,kind:SnapshotKind='accounts'){return carryReturn(snapshotHref(context,date,epoch,kind),context,search);}
export function historySnapshotHref(context:BetaContext,selection:HistorySelection,epoch?:string|null,storageDate:string=selection.date){
 const search=new URLSearchParams({_historyDate:selection.date,_historyPeriod:selection.period,_historyMetric:selection.metric,_historyScope:context.scope,_historyCurrency:context.currency,_historyReturn:'origin'});
 return continueSnapshotHref(context,storageDate,epoch,search);
}
