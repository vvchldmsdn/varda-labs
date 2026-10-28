import type {getReadOnlyTenantInvestmentLabAnalysisScopeEvidence} from '../../db/queries/investment-lab-scope-evidence';
import type {getReadOnlyTenantInvestmentLabCounterfactualForScope} from '../../db/queries/investment-lab';
import type {BetaReadPorts} from './read-service';
import {adaptLab,blankLab,labPeriodRequest,validLabParams,type LabParams,type LabRead} from './lab-contract';
export type LabPorts=Pick<BetaReadPorts,'session'|'scopes'> & {evidence:typeof getReadOnlyTenantInvestmentLabAnalysisScopeEvidence;research:typeof getReadOnlyTenantInvestmentLabCounterfactualForScope};
export async function readBetaLab(p:LabParams,ports:LabPorts):Promise<LabRead>{const base=blankLab(p,'unavailable','과거 비교 조회 실패 · 다른 읽기는 유지됩니다');
 if(!validLabParams(p))return {...base,state:'invalid',message:'기간·실행 조건 오류 · 양쪽 날짜, 중복·형식·순서를 확인하세요'};
 try{const session=await ports.session();if(!session.ok)return {...base,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'사용자 확인 전 · 금융 자료를 조회하지 않았습니다'};
 const scopes=await ports.scopes({scope:p.scope,tenantContext:session.tenantContext});if(scopes.state!=='ready')return base;
 base.scopes=scopes.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'소유 범위 전체':s.kind==='account'?'소유 계좌':'소유 분석 범위'}));
 if(scopes.resolution.state!=='resolved')return {...base,state:'unauthorized',message:'허용되지 않은 범위 · 전체 범위로 대체하지 않습니다'};
 if(p.run!=='1')return {...base,state:'idle',message:'기간을 확인하고 과거 비교 실행 · 아직 연구하지 않았습니다'};
 const args={scope:scopes.resolution.scope,tenantContext:session.tenantContext};
 // One scope evidence promise and one existing orchestrator supply readiness and result together.
 // Auxiliary comparisons inside the original loader still run; no separate readiness call.
 const evidencePromise=ports.evidence(args);
 const source=await ports.research({...args,evidencePromise,request:labPeriodRequest(p)}),model=adaptLab(source,await evidencePromise);
 const usable=['full','current_writer','selected'].includes(model.period.status),ready=usable&&model.comparison.status==='ready';
 return {...base,model,state:!usable?'blocked':ready?(model.observedHistory.status==='partial'?'partial':'ready'):'blocked',message:!usable?'요청 기간의 비교 근거 부족 · 다른 기간으로 대체하지 않습니다':ready?'저장 관측과 동일 거래금액 기반 KODEX 200 과거 비교 · 분석 기준 KRW':'비교 계산 보류 · 허용된 관측 이력만 표시합니다'};
 }catch{return base;}}
