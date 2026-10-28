import 'server-only';
import {notFound,redirect} from 'next/navigation';
import {betaReadHref} from './navigation';
import {readSharedBackendRuntime} from '../shared-backend/runtime';
// Preserve local-only fixtures. The explicitly configured shared service uses
// real session admission in the layout and every original read/action.
export async function requireBetaFixtureAccess(){
 if((await readSharedBackendRuntime()).betaAccess==='closed')notFound();
}
export async function betaUsesSharedService(){
 return (await readSharedBackendRuntime()).betaAccess==='service';
}
const betaPagePaths=new Set(["/beta/analysis","/beta/etfs","/beta/history/events","/beta/history","/beta/history/position-snapshots","/beta/history/snapshots","/beta/investment-lab","/beta","/beta/plans","/beta/portfolio/accounts/manage","/beta/portfolio/accounts","/beta/portfolio/groups","/beta/portfolio/holdings/manage","/beta/portfolio/holdings/new","/beta/portfolio/holdings","/beta/portfolio/ledger","/beta/portfolio/structure","/beta/portfolio/targets","/beta/simulation"]);
export async function prepareBetaPageParams(params:Record<string,string|string[]|undefined>,pathname:string){
 // Pages and layouts may render in parallel: beta admission precedes every read.
 await requireBetaFixtureAccess();
 // Callers supply a fixed page route. Query/hash/return destinations never select it.
 if(!betaPagePaths.has(pathname)||betaReadHref(pathname)!==pathname)throw new Error('Unknown beta page destination');
 if(await betaUsesSharedService()&&params.mode===undefined){
  const query=new URLSearchParams();
  for(const [key,value] of Object.entries(params)){
   if(value===undefined)continue;
   if(Array.isArray(value)&&value.length===0)throw new Error('Invalid empty query array');
   for(const item of Array.isArray(value)?value:[value])query.append(key,item);
  }
  query.append('mode','domain');
  // Canonicalize the URL too: client query keys and lifecycle rechecks read it.
  // Preserve every explicit value/duplicate for the original read validation.
  redirect(betaReadHref(pathname+'?'+query));
 }
 return params;
}
