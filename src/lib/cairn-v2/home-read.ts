import {betaReadHref} from './navigation';
import type {DomainRead} from './read-contract';
import type { SimulationRead } from './simulation-contract';
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
export async function readBetaHome(params:Params,ports:{domain:(params:Params,options:{includeHeatmap:boolean;includeCurrentValue:boolean;historyWindow:"recent"})=>Promise<DomainRead>;simulation?:(params:Params)=>Promise<SimulationRead>}){
 const read=await ports.domain(params,{includeHeatmap:true,includeCurrentValue:true,historyWindow:"recent"});
 // Research is requested by the dialog only; the initial home never reads its
 // multi-year evidence or computes paths that the user has not asked to see.
 return {read};
}
