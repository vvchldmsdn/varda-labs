import {domainContext,domainQueryValid,type BetaReadPorts} from './read-service';
import {blankSimulation,type SimulationRead} from './simulation-contract';
import {adaptOwnerResearch,ownerSimulationState,type SimulationResearchResult} from './simulation-adapter';
import {resolveSimulationResearchHorizon} from '../simulation-research-horizon';
import {resolveSimulationOwnerExecutionEndSelection} from '../simulation-owner-research-execution';
import {resolveSnapshotCycle} from '../snapshots/market-calendar';
import type {getReadOnlyTenantSimulationOwnerResearch} from '../../db/queries/simulation-owner-research';
export type SimulationPorts=Pick<BetaReadPorts,'session'|'scopes'|'now'> & {research:(options:Parameters<typeof getReadOnlyTenantSimulationOwnerResearch>[0])=>Promise<SimulationResearchResult>} & {admission?:'tenant_owned_shared_history'};
export async function readBetaSimulation(params:Record<string,string|string[]|undefined>,ports:SimulationPorts):Promise<SimulationRead> {
 const context=domainContext(params),result=blankSimulation(context,'unavailable','현재 보유 연구 조회 실패 · 다른 읽기 화면은 독립적으로 유지됩니다');
 if(!domainQueryValid(params)||resolveSimulationResearchHorizon(params.horizon).status!=='valid'||(params.end!==undefined&&resolveSimulationOwnerExecutionEndSelection({suppliedValue:params.end,latestCommonStoredServiceDate:null}).status!=='valid')||(params.run!==undefined&&params.run!=='1'))return {...result,state:'invalid',message:'기간·기준일·실행 조건 오류 · 중복/지원 외 입력을 대체하지 않습니다'};
 try {
  const session=await ports.session();if(!session.ok)return {...result,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'사용자 확인 전 · 연구 조회/계산하지 않음'};
  const scopes=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});if(scopes.state!=='ready')return result;
  result.scopes=scopes.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'소유 범위 전체':s.kind==='account'?'소유 계좌':'소유 분석 범위'}));
  if(scopes.resolution.state!=='resolved')return {...result,state:'unauthorized',message:'허용되지 않은 조회 범위 · 연구 조회/계산하지 않음'};
  const now=ports.now?.()??new Date();result.context={...context,scope:scopes.resolution.scope.key};result.serviceDate=resolveSnapshotCycle(now).snapshotDate;result.generatedAt=now.toISOString();
  if(params.run!=='1')return {...result,state:'idle',message:'조건을 확인한 뒤 연구 실행 · 아직 계산하지 않음'};
  // One authorized port call supplies preflight and execution. Shared service uses stored scoped evidence only.
  const research=await ports.research({scope:scopes.resolution.scope,tenantContext:session.tenantContext,serviceDate:result.serviceDate,endServiceDate:params.end,horizon:params.horizon,now});
  const model=adaptOwnerResearch(research);return {...result,...ownerSimulationState(model),model};
 }catch{return result;}
}
