import type {OwnerSimulationModel,SimulationRead} from './simulation-contract';
import type {ReadOnlyTenantSimulationOwnerResearchResult} from '../../db/queries/simulation-owner-research';
import {PRIVATE_OWNER_RAW_HISTORY_POLICY} from '../simulation-private-owner-raw-history';
import type {PrivateOwnerRawHistoryResult} from '../shared-domain/simulation-private-owner-raw-history';
import type {SimulationPriceFrontier} from '../shared-domain/market-data/kis-history-finalization';
export type SimulationResearchResult=Pick<ReadOnlyTenantSimulationOwnerResearchResult,'inputPreflight'|'execution'> & {priceFrontier?:SimulationPriceFrontier|null;pricePolicy?:PrivateOwnerRawHistoryResult['policy'];historyRecovery?:{requestedEndServiceDate:string;verifiedEndServiceDate:string}|null};
// Exact public evidence fields only; raw rows, internal owners, and auxiliary research never cross this boundary.
function evidence(value:unknown,keys:readonly string[]) {
 const o=value && typeof value==='object'?value as Record<string,unknown>:{};
 return Object.fromEntries(keys.flatMap(key=>{const v=o[key];return typeof v==='string'||typeof v==='number'||v===null||Array.isArray(v)&&v.every(x=>typeof x==='string')?[[key,v]]:[];}));
}
export function adaptOwnerResearch(read:SimulationResearchResult) {
 const p=read.inputPreflight,e=read.execution;
 return {
  candidate:{status:p.status,policy:p.policy,summary:p.summary,blockers:p.blockers,identityGaps:p.identityGaps,valuationGaps:p.valuationGaps,evidenceSummary:p.evidenceSummary,requestedEndServiceDate:p.requestedEndServiceDate,historicalPriceBasis:p.historicalPriceBasis,corporateActionAdjustment:p.corporateActionAdjustment,distributionAdjustment:p.distributionAdjustment,
   instruments:p.instruments.map(r=>({instrumentKey:r.instrumentKey,accounts:r.accounts,name:r.name,ticker:r.ticker,market:r.market,currency:r.currency,classification:r.classification,currentValueKrw:r.currentValueKrw,weightBps:r.weightBps,historicalStatus:r.historicalStatus,admissionStatus:r.admissionStatus,storedCoverage:evidence(r.storedCoverage,['status','readyReturnCount','requiredReturnCount','reasons']),provenance:evidence(r.provenance,['status','priceBasis','adjustment','storedRowCount','rawCloseRowCount','qualifiedRowCount','sourceDateFrom','sourceDateTo','sources','providerSymbols','providerExchanges','issues'])}))},
  execution:{status:e.status,reason:e.reason,policy:e.policy,source:e.source,endSelection:e.endSelection,coverage:e.coverage,instruments:e.instruments,executionWeights:e.executionWeights,assumptions:e.assumptions,terminal:e.terminal,bands:e.bands,samplePaths:e.samplePaths,displayPaths:e.displayPaths},
  historyRecovery:read.historyRecovery??null,
  priceFrontier:read.priceFrontier??null,
  pricePolicy:read.pricePolicy??PRIVATE_OWNER_RAW_HISTORY_POLICY,
 };
}
export function ownerSimulationState(model:OwnerSimulationModel):Pick<SimulationRead,'state'|'message'> {
 const e=model.execution,p=model.candidate;
 if(e.status==='ready')return e.coverage.omittedWeightBps>0||p.summary.fountExcludedHoldingCount>0?{state:'partial',message:'포함 종목의 부분 연구 · 제외 보유를 포함한 전체 결과가 아닙니다'}:{state:'ready',message:'현재 보유 연구 · KRW 기준 가격 수익 · 미래 예측 아님'};
 if(p.blockers.includes('empty_positive_portfolio')&&!p.summary.valuationGapCount)return {state:'empty',message:'연구할 양의 현재 보유가 없습니다'};
 const issues=p.instruments.flatMap(r=>Array.isArray(r.provenance.issues)?r.provenance.issues:[]);
 if(issues.includes('private_single_tenant_scope_not_established'))return {state:'unsupported',message:'단일 활성 소유자와 요청자 일치 조건 미충족 · 권한 거절과 별개의 연구 지원 제한'};
 return {state:'unavailable',message:'연구 실행 불가 · 관측·가격·환율·포함 근거를 확인하세요'};
}
