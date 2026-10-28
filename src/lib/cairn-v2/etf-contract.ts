import type {ReadOnlyEtfHoldingsResult,ReadOnlyEtfMasterSearchResult} from '../../db/queries/etf-holdings';
import type {GroupedEtfHoldingRow} from '../etf-holdings';
import {toNumber} from '../portfolio-math';
import {parseTenantSnapshotDateQuery} from '../tenant-snapshot-date-query';
import {betaReadHref,type BetaContext} from './navigation';
import {domainContext,domainQueryValid} from './read-service';
export type EtfParams=Record<string,string|string[]|undefined>;
export type EtfState='loading'|'unselected'|'search-empty'|'ready'|'partial'|'empty'|'invalid'|'not-found'|'unavailable'|'unauthorized';
export type PublicMaster=Pick<ReadOnlyEtfMasterSearchResult,'id'|'ticker'|'name'|'market'|'currency'>;
export type EtfGroup=Omit<GroupedEtfHoldingRow,'rawRows'> & {evidence:Array<{source:string|null;currency:string|null;rank:number|null;weightPct:string|number|null;shares:string|number|null;marketValue:string|number|null}>;incompleteNumbers:boolean};
export type EtfRead={context:BetaContext;state:EtfState;message:string;queryKey:string;readReceipt?:string;readEpoch?:string;readAt?:string;scopes:Array<{key:string;label:string;detail:string}>;masters:PublicMaster[];selected:PublicMaster|null;date:string|null;latest:boolean;groups:EtfGroup[];rawRowCount:number;groupedRowCount:number;duplicateGroupCount:number};
const queryFields=['q','etfMasterId','ticker','asOfDate'] as const;
// ETF master identity only: validate before canonicalizing; invalid/duplicate input stays invalid.
export function canonicalEtfMasterId(value:unknown):string|undefined{return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)?value.toLowerCase():undefined;}
const etfQueryValue=(p:EtfParams,k:typeof queryFields[number])=>k==='etfMasterId'?(canonicalEtfMasterId(p[k])??p[k]):p[k];
export function etfParams(search:URLSearchParams):EtfParams{const p:EtfParams={};for(const k of ['mode','scope','currency','account','fixture','id','_betaRead',...queryFields]){const a=search.getAll(k);if(a.length)p[k]=a.length===1?a[0]:a;}return p;}
export function etfKey(p:EtfParams){return JSON.stringify([p.mode,p.scope??'all',p.currency??'KRW',p.account,p.fixture,p.id,...queryFields.map(k=>etfQueryValue(p,k))]);}
export function validEtfParams(p:EtfParams){if(!domainQueryValid(p)||p.id!==undefined)return false;
 if(p.q!==undefined&&(typeof p.q!=='string'||!p.q.trim()||p.q!==p.q.trim()||p.q.length>120||/[\x00-\x1f\x7f%_]/.test(p.q)))return false;
 if(p.etfMasterId!==undefined&&!canonicalEtfMasterId(p.etfMasterId))return false;
 if(p.ticker!==undefined&&(typeof p.ticker!=='string'||!p.etfMasterId||!(/^[A-Za-z0-9.^/-]{1,32}$/).test(p.ticker)))return false;
 if(p.asOfDate!==undefined&&(typeof p.asOfDate!=='string'||p.asOfDate!==p.asOfDate.trim()||!p.asOfDate||!parseTenantSnapshotDateQuery(p.asOfDate)))return false;
 return true;}
export function blankEtf(p:EtfParams,state:EtfState,message:string):EtfRead{return {context:domainContext(p),queryKey:etfKey(p),state,message,scopes:[],masters:[],selected:null,date:typeof p.asOfDate==='string'?p.asOfDate:null,latest:p.asOfDate===undefined,groups:[],rawRowCount:0,groupedRowCount:0,duplicateGroupCount:0};}
export const publicMaster=(r:PublicMaster):PublicMaster=>({id:canonicalEtfMasterId(r.id)??r.id,ticker:r.ticker,name:r.name,market:r.market,currency:r.currency});
export function adaptEtf(base:EtfRead,result:ReadOnlyEtfHoldingsResult):EtfRead{
 const groups=result.groupedHoldings.map(r=>({identityKey:r.identityKey,etfTicker:r.etfTicker,etfName:r.etfName,asOfDate:r.asOfDate,holdingSymbol:r.holdingSymbol,holdingName:r.holdingName,rawRowCount:r.rawRowCount,hasDuplicates:r.hasDuplicates,source:r.source,rank:r.rank,weightPct:r.weightPct,shares:r.shares,marketValue:r.marketValue,holdingMarket:r.holdingMarket,holdingCountry:r.holdingCountry,currency:r.currency,sector:r.sector,industry:r.industry,securityType:r.securityType,
 evidence:r.rawRows.map(v=>({source:v.source,currency:v.currency,rank:v.rank,weightPct:v.weightPct,shares:v.shares,marketValue:v.marketValue})),
 incompleteNumbers:r.rawRows.some(v=>[v.weightPct,v.shares,v.marketValue].some(n=>toNumber(n)===null))}));
 const partial=groups.some(r=>r.incompleteNumbers||r.source.status!=='single'||r.currency.status!=='single'||r.rank.disagrees||[r.holdingMarket,r.holdingCountry,r.sector,r.industry,r.securityType].some(t=>t.status==='mixed'));
 return {...base,selected:result.etfMaster?publicMaster(result.etfMaster):null,date:result.asOfDate||base.date,groups,rawRowCount:result.rawRowCount,groupedRowCount:result.groupedRowCount,duplicateGroupCount:result.duplicateGroupCount,state:!groups.length?'empty':partial?'partial':'ready',message:!groups.length?'이 기준일의 저장 구성 없음 · 다른 날짜로 대체하지 않았습니다':partial?'부분 근거 · 누락 또는 출처·통화 혼합, 순위 불일치를 확인하세요':'저장 구성 참고 · 개인의 구성기업 보유액이 아닙니다'};
}
export function etfHref(context:BetaContext,p:EtfParams,epoch?:string|null){const q=new URLSearchParams({mode:'domain',scope:context.scope,currency:context.currency});for(const k of queryFields){const v=etfQueryValue(p,k);if(v!==undefined)for(const value of Array.isArray(v)?v:[v])q.append(k,value);}return betaReadHref('/beta/etfs?'+q+'#etf-reference',epoch);}
export function etfNumber(n:string|number|null){return n===null?'—':String(n);}
export const etfStatusLabels:Record<string,string>={sum:'확인값 합산',empty:'자료 없음',multiple_sources:'출처 혼합 · 합산 보류',mixed_currency:'통화 혼합 · 합산 보류',single:'단일',mixed:'혼합'};
