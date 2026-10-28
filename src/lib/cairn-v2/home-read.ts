import {betaReadHref} from './navigation';
import type {DomainRead} from './read-contract';
import {blankSimulation,type SimulationRead} from './simulation-contract';
type Params=Record<string,string|string[]|undefined>;
// Only the missing home input receives a default. Explicit invalid/duplicate
// inputs and all other query values still reach the existing validators.
export function defaultHomeContributionHref(params:Params):string|null {
 if(params.mode!=='domain'||params.cashAmountKrw!==undefined)return null;
 const query=new URLSearchParams();
 for(const [key,raw] of Object.entries(params))if(raw!==undefined)for(const value of Array.isArray(raw)?raw:[raw])query.append(key,value);
 query.set('cashAmountKrw','1000000');
 return betaReadHref('/beta?'+query);
}
export async function readBetaHome(params:Params,ports:{domain:(params:Params,options:{includeHeatmap:boolean})=>Promise<DomainRead>;simulation:(params:Params)=>Promise<SimulationRead>}){
 const read=await ports.domain(params,{includeHeatmap:true});
 // Request-local promise, never a cache across users. Original simulation port
 // repeats its own session/scope/single-owner admission; no readiness double call.
 const state=read.view.domain?.state;
 const simulationPromise=state&&['ready','partial','empty'].includes(state)
  ?Promise.resolve().then(()=>ports.simulation({...params,run:params.run??'1'})).catch(()=>({...blankSimulation({...read.context,run:params.run??'1'},'unavailable','시뮬레이션 조회 불가 · 다시 시도해 주세요'),readReceipt:read.readReceipt,readEpoch:read.readEpoch}))
  :undefined;
 return {read,simulationPromise};
}
