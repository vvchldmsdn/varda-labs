import type {BetaReadPorts} from './read-service';
import type {searchReadOnlyEtfMasters,getReadOnlyEtfHoldings} from '../../db/queries/etf-holdings';
import {adaptEtf,blankEtf,publicMaster,validEtfParams,canonicalEtfMasterId,type EtfParams,type EtfRead,type PublicMaster} from './etf-contract';
export type EtfPorts=Pick<BetaReadPorts,'session'|'scopes'> & {search:typeof searchReadOnlyEtfMasters;holdings:typeof getReadOnlyEtfHoldings;master:(id:string)=>Promise<PublicMaster|null>};
export async function readBetaEtf(params:EtfParams,ports:EtfPorts):Promise<EtfRead>{
 let base=blankEtf(params,'unavailable','ETF 참고 자료 조회 실패 · 다른 자료로 대체하지 않음');
 if(!validEtfParams(params))return {...base,state:'invalid',message:'조회 조건 오류 · 중복·빈 값·잘못된 ID/날짜는 자동 선택하지 않습니다. 티커만으로 선택할 수 없습니다'};
 try{
 const session=await ports.session();if(!session.ok)return {...base,state:session.failure.httpStatus===401||session.failure.httpStatus===403?'unauthorized':'unavailable',message:'활성 사용자 확인 전 · ETF 자료를 읽지 않았습니다'};
 const scope=await ports.scopes({scope:params.scope,tenantContext:session.tenantContext});
 if(scope.state!=='ready')return base;
 base={...base,scopes:scope.catalog.scopes.map(s=>({key:s.key,label:s.label,detail:'화면의 소유 조회 문맥 · ETF 구성은 공용 참고 자료'}))};
 if(scope.resolution.state!=='resolved')return {...base,state:'unauthorized',message:'허용되지 않은 조회 문맥 · 전체로 대체하지 않음'};
 const masters=await ports.search({query:typeof params.q==='string'?params.q:undefined,limit:24});
 base={...base,masters:masters.map(publicMaster)};
 const id=canonicalEtfMasterId(params.etfMasterId);
 if(!id)return {...base,state:masters.length?'unselected':'search-empty',message:masters.length?'ETF를 선택하세요 · 첫 검색 결과를 자동 선택하지 않습니다':'검색 결과 없음 · 최대 24건 범위'};
 if(params.q!==undefined&&!masters.some(m=>canonicalEtfMasterId(m.id)===id))return {...base,state:'invalid',message:'검색 결과 범위와 명시 ETF가 다릅니다 · 검색을 비우고 ID로 다시 조회하세요'};
 const known=masters.find(m=>canonicalEtfMasterId(m.id)===id)??await ports.master(id);
 if(!known)return {...base,state:'not-found',message:'선택 ID의 ETF를 확인할 수 없습니다 · 다른 ETF로 대체하지 않음'};
 if(known&&typeof params.ticker==='string'&&known.ticker.toUpperCase()!==params.ticker.toUpperCase())return {...base,state:'invalid',message:'명시 ID와 티커가 일치하지 않습니다'};
 const result=await ports.holdings({etfMasterId:id,asOfDate:typeof params.asOfDate==='string'?params.asOfDate:undefined});
 if(!result)return {...base,state:'empty',selected:publicMaster(known),message:'이 ETF의 저장 구성 기준일 없음 · 다른 ETF로 대체하지 않음'};
 if(!result||!result.etfMaster||canonicalEtfMasterId(result.etfMaster.id)!==id)return {...base,state:'not-found',message:'선택 ID의 ETF 또는 저장 기준일을 확인할 수 없습니다 · 다른 ETF로 대체하지 않음'};
 if(typeof params.ticker==='string'&&result.etfMaster.ticker.toUpperCase()!==params.ticker.toUpperCase())return {...base,state:'invalid',message:'명시 ID와 티커가 일치하지 않습니다'};
 if(typeof params.asOfDate==='string'&&result.asOfDate!==params.asOfDate)return {...base,state:'unavailable',message:'지정일과 반환 기준일이 다릅니다 · 구성 표시 보류'};
 return adaptEtf(base,result);
 }catch{return {...base,state:'unavailable',message:'ETF 참고 자료 조회 실패 · 다른 자료로 대체하지 않음'};}
}
