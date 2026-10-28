import type { BetaContext } from './navigation';
import type { PortfolioRiskReadModel } from '../portfolio-risk-read-model';
import type { PortfolioStructureResult } from '../portfolio-structure';
import { buildPortfolioDirectHoldingsBaseline, type PortfolioDirectHoldingsBaseline } from '../portfolio-direct-holdings.ts';
import type { ReadState } from './read-contract';
export type AnalysisRead = {
 context: BetaContext; state: ReadState; message: string;
 scopes: {key:string;label:string;detail:string}[];
 risk: PortfolioRiskReadModel | null; direct: PortfolioDirectHoldingsBaseline | null;
 serviceDate: string | null; exclusions: PortfolioStructureResult['exclusions'];
 readReceipt?: string; readEpoch?: string;
};
export const analysisKey = (c: BetaContext) => JSON.stringify([c.mode,c.scope,c.currency,c.analysis ?? 'risk',c.window ?? '90']);
export function blankAnalysis(context: BetaContext,state: ReadState,message:string): AnalysisRead {
 return {context,state,message,scopes:[],risk:null,direct:null,serviceDate:null,exclusions:[]};
}
export function adaptRisk(model: PortfolioRiskReadModel) {
 const state: ReadState = model.provenance.selectedHoldingCount === 0 ? 'empty' : model.calculation.calculationStatus === 'unavailable' || model.calculation.calculationStatus === 'invalid' ? 'unavailable' : model.inputHealth.exclusions.length || model.calculation.calculationStatus !== 'complete' || model.inputHealth.status !== 'ready' ? 'partial' : 'ready';
 // Preserve model precision, missing metric reasons, admission and date-specific FX provenance.
 return {risk:model,state,message:state === 'ready' ? '기존 위험 모델 · 분석 기준 KRW' : state === 'empty' ? '분석할 현재 보유 없음' : '관측·제외 근거 확인 · 전체 포트폴리오 결과와 구분'};
}
export function adaptDirect(model: PortfolioStructureResult) {
 const direct=buildPortfolioDirectHoldingsBaseline(model);
 const state: ReadState = model.dataHealth.selectedAssetCount === 0 ? 'empty' : direct.status === 'complete' ? 'ready' : direct.status === 'partial' ? 'partial' : 'unavailable';
 return {direct,state,exclusions:model.exclusions,message:state === 'partial' ? '확인 가능한 직접 보유 소계 기준 · 제외 자산 미포함' : state === 'empty' ? '현재 직접 보유 없음 · 과거 기록과 구분' : '직접 보유 기준 · ETF 내부 기업 노출 미포함'};
}
