import {domainContext,domainQueryValid,type BetaReadPorts} from './read-service';
import {isNamedPortfolioAccount} from '../portfolio-account-scope';
import type {getReadOnlyTenantEvents} from '../../db/queries/tenant-events';
import {blankEvents,eventDate,adaptEvents,type EventRead} from './event-contract';
export type EventPorts=Pick<BetaReadPorts,'session'|'scopes'> & {events:typeof getReadOnlyTenantEvents};
export async function readBetaEvents(params:Record<string,string|string[]|undefined>,ports:EventPorts):Promise<EventRead>{
 const context=domainContext(params),date=eventDate(params.date);let base=blankEvents(context,date,'unavailable','이벤트를 읽을 수 없습니다');
 if(!domainQueryValid(params)||(params.date!==undefined&&!date))return {...base,state:'unauthorized',message:'조회 조건 오류 · 날짜/중복/가상 범위는 자동 대체하지 않습니다'};
 try{const session=await ports.session();if(!session.ok)return {...base,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'사용자 확인 전 · 이벤트 조회하지 않음'};
 const catalog=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});if(catalog.state!=='ready')return base;
 base={...base,scopes:catalog.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:s.kind==='all'?'소유 범위 전체':s.kind==='account'?'소유 계좌':'소유 분석 범위'}))};
 if(catalog.resolution.state!=='resolved')return {...base,state:'unauthorized',message:'허용되지 않은 범위 · 이벤트 조회하지 않음'};
 const scope=catalog.resolution.scope;
 if(scope.kind==='portfolio_group'||(scope.kind==='account'&&!isNamedPortfolioAccount(scope.accountCode)))return {...base,state:'unsupported',message:'현재 이벤트 모델은 연결된 brokerage/isa/irp 계좌만 지원 · 분석 그룹/다른 계좌 미연결'};
 base={...base,includedAccounts:scope.kind==='account'?[scope.accountCode]:catalog.catalog.scopes.flatMap(s=>s.kind==='account'&&isNamedPortfolioAccount(s.accountCode)?[s.accountCode]:[])};
 if(!date)return {...base,state:'idle',message:'날짜를 선택하면 연결된 이벤트를 읽습니다 · 아직 조회하지 않음'};
 return adaptEvents(base,await ports.events({tenantContext:session.tenantContext,scope:scope.kind==='account'&&isNamedPortfolioAccount(scope.accountCode)?scope.accountCode:'all'}));
 }catch{return base;}
}
