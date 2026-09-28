import { createHash } from 'node:crypto';
import type { PortfolioTargetUniverseInput } from './portfolio-target-policy';
export const TARGET_PLAN_VERSION = 'portfolio_target_policy_v2';
type Saved = {assetId:string;originAssetId?:string|null;accountId:string;market:string;currency:string;ticker:string|null;assetName:string;assetType?:string|null};
export const targetInstrumentIdentity=(r:Pick<Saved,'accountId'|'market'|'currency'|'ticker'|'assetId'>)=>[r.accountId,r.market,r.currency,r.ticker??r.assetId].join(':');
export function targetPlanRowId(owner:string,account:string,market:string,currency:string,ticker:string){
 const h=createHash('sha256').update(JSON.stringify(['target-plan-v2',owner,account,market,currency,ticker])).digest('hex');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}
export function unionTargetPlanRows(holdings:readonly PortfolioTargetUniverseInput[], saved:readonly Saved[], accounts:readonly {id:string;code:string;name:string}[]){
 const identities=new Set<string>();
 for(const row of saved){const key=targetInstrumentIdentity(row);if(identities.has(key))throw new Error('ambiguous_target_instrument');identities.add(key);}
 const seen=new Set<string>(), bound=new Set<string>();
 const result:PortfolioTargetUniverseInput[]=holdings.map(row=>{
   const identity=targetInstrumentIdentity(row);
   if(seen.has(identity))throw new Error('ambiguous_holding_instrument');seen.add(identity);
   const plan=saved.find(p=>targetInstrumentIdentity(p)===identity);
   if(!plan)return {...row,originAssetId:row.assetId,heldAssetId:row.assetId};
   bound.add(plan.assetId);
   return {...row,assetId:plan.assetId,originAssetId:plan.originAssetId===undefined?plan.assetId:plan.originAssetId,heldAssetId:row.assetId};
 });
 for(const plan of saved){
   if(bound.has(plan.assetId))continue;
   const account=accounts.find(a=>a.id===plan.accountId);if(!account)throw new Error('target_account_unavailable');
   result.push({...plan,accountCode:account.code,accountName:account.name,assetType:plan.assetType??null,
     originAssetId:plan.originAssetId===undefined?plan.assetId:plan.originAssetId,heldAssetId:null,currentValueKrw:0});
 }
 return result;
}
