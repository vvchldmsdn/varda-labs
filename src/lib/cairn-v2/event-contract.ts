import type {BetaContext} from './navigation';
import {betaHref,betaReadHref} from './navigation';
import type {TenantEventLedgerQueryResult} from '../../db/queries/tenant-events';
import type {TenantEventLedgerDto} from '../tenant-event-ledger-read-model';
export type EventRow=Pick<TenantEventLedgerDto,'eventDate'|'recordedAt'|'accountCode'|'accountName'|'ticker'|'assetName'|'eventKind'|'assetReferenceStatus'|'correctionStatus'|'evidenceStatus'|'missingFields'|'amountKrw'|'quantityDelta'> & {eventType:'buy'|'sell'|'asset_added'|'asset_removed'|'unsupported'};
export type EventRead={context:BetaContext;date:string|null;state:'idle'|'ready'|'partial'|'empty'|'unavailable'|'unauthorized'|'unsupported'|'loading';message:string;rows:EventRow[];scopes:{key:string;label:string;detail:string}[];includedAccounts:string[];rowLimitExceeded:boolean;readReceipt?:string;readEpoch?:string;queryKey?:string;readAt?:string};
export function eventDate(value:unknown):string|null {if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const t=Date.parse(value+'T00:00:00.000Z');return Number.isFinite(t)&&new Date(t).toISOString().slice(0,10)===value?value:null;}
export function blankEvents(context:BetaContext,date:string|null,state:EventRead['state'],message:string):EventRead{return {context,date,state,message,rows:[],scopes:[],includedAccounts:[],rowLimitExceeded:false};}
export function eventKey(context:BetaContext,date:unknown){return JSON.stringify([context.mode,context.scope,context.currency,date]);}
export function eventHref(context:BetaContext,date:string|string[]|undefined,epoch?:string|null){const url=new URL(betaHref('/beta/history',context),'https://beta.invalid');url.pathname='/beta/history/events';if(date!==undefined)for(const d of Array.isArray(date)?date:[date])url.searchParams.append('date',d);return betaReadHref(url.pathname+url.search+'#date-events',epoch);}
export function adaptEvents(base:EventRead,result:TenantEventLedgerQueryResult):EventRead {
 if(result.state==='unavailable')return {...base,state:'unavailable',message:'이벤트 읽기 실패 · 히스토리 평가 읽기와 별개'};
 if(result.state==='integrity_error')return {...base,state:'unavailable',message:'이벤트 관계 검증 실패 · 기록을 표시하지 않습니다'};
 if(result.state==='no_data')return {...base,state:'empty',message:'소유 계좌에 연결된 기록 없음 · 연결되지 않은 레거시/다른 유형의 존재 여부는 확인하지 않음'};
 const rows:EventRow[]=result.events.filter(r=>r.eventDate===base.date).map(r=>({eventDate:r.eventDate,recordedAt:r.recordedAt,accountCode:r.accountCode,accountName:r.accountName,ticker:r.ticker,assetName:r.assetName,eventType:['buy','sell','asset_added','asset_removed'].includes(r.eventType)?r.eventType as EventRow['eventType']:'unsupported',eventKind:r.eventKind,assetReferenceStatus:r.assetReferenceStatus,correctionStatus:r.correctionStatus,evidenceStatus:r.evidenceStatus,missingFields:[...r.missingFields],amountKrw:r.amountKrw,quantityDelta:r.quantityDelta}));
 return {...base,rows,rowLimitExceeded:result.rowLimitExceeded,state:result.state==='partial'?'partial':rows.length?'ready':'empty',message:result.state==='partial'?'부분 근거 · 누락 또는 최신 100개 표시 한도 · 전체 거래 내역 아님':rows.length?'선택 날짜의 연결된 기록 · 전체 거래 내역 아님':'읽은 범위에서 선택 날짜의 연결 기록 없음'};
}
