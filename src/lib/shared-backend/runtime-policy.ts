import {betaFixtureAccessAllowed} from '../cairn-v2/access-policy.ts';
import {betaManagementAccessAllowed} from '../cairn-v2/management-access-policy.ts';
export const SHARED_BACKEND_SOURCE='candidate-736f' as const;
export const SHARED_SERVICE_RUNTIME='shared-service-v1' as const;
export const PARALLEL_BETA_RUNTIME='parallel-frontends-v1' as const;
export type SharedRuntimeInput=Parameters<typeof betaManagementAccessAllowed>[0]&{source?:string;runtime?:string;betaRuntime?:string};
export type SharedRuntimeAssessment=Readonly<{
 binding:'baseline'|'aligned'|'blocked';execution:'baseline'|'synthetic'|'service'|'blocked';
 mutations:boolean;betaAccess:'fixture'|'service'|'closed';betaManagement:boolean;
 reason:'baseline'|'synthetic'|'service'|'integrated_service'|'source_invalid'|'runtime_invalid'|'fixture_conflict'|'read_only';
}>;
// Server configuration selects one implementation; it never proves session,
// ownership, DB role, rollout admission or permission to mutate an asset.
export function assessSharedBackendRuntime(input:SharedRuntimeInput):SharedRuntimeAssessment{
 const fixture=betaFixtureAccessAllowed(input),readonly=input.liveReadOnly==='1';
 // Both frontends now ship from master in one Next application. Unconfigured
 // production uses canonical session/tenant ports; fixtures never become live.
 if(input.nodeEnv==='production'&&input.source===undefined&&input.runtime===undefined&&input.betaRuntime===undefined){
  const blocked=readonly||input.enabled!==undefined&&input.enabled!=='0'||input.liveReadOnly!==undefined&&!['0','1'].includes(input.liveReadOnly);
  return Object.freeze({binding:blocked?'blocked':'aligned',execution:blocked?'blocked':'service',mutations:!blocked,
   betaAccess:blocked?'closed':'service',betaManagement:!blocked,
   reason:readonly?'read_only':blocked?'fixture_conflict':'integrated_service'});
 }
 if(input.source===undefined&&input.runtime===undefined)return Object.freeze({
  binding:'baseline',execution:'baseline',mutations:!readonly,
  betaAccess:input.betaRuntime===undefined&&fixture?'fixture':'closed',
  betaManagement:input.betaRuntime===undefined&&betaManagementAccessAllowed(input),reason:'baseline'});
 const blocked=(reason:SharedRuntimeAssessment['reason']):SharedRuntimeAssessment=>Object.freeze({
  binding:'blocked',execution:'blocked',mutations:false,betaAccess:'closed',betaManagement:false,reason});
 if(input.source!==SHARED_BACKEND_SOURCE)return blocked('source_invalid');
 // The personal read-only deployment is a separate composition. A shared
 // source must not promote it or silently fall back to another writer.
 if(readonly)return blocked('read_only');
 if(input.runtime===undefined){
  if(!betaManagementAccessAllowed(input))return blocked('runtime_invalid');
  return Object.freeze({binding:'aligned',execution:'synthetic',mutations:true,
   betaAccess:input.betaRuntime===undefined?'fixture':'closed',betaManagement:input.betaRuntime===undefined,reason:'synthetic'});
 }
 if(input.runtime!==SHARED_SERVICE_RUNTIME||!['development','production'].includes(input.nodeEnv??'')||
  (input.liveReadOnly!==undefined&&!['0','1'].includes(input.liveReadOnly)))return blocked('runtime_invalid');
 // Never promote the fixture switch into a shared service deployment.
 if(input.enabled!==undefined&&input.enabled!=='0')return blocked('fixture_conflict');
 const beta=input.betaRuntime===PARALLEL_BETA_RUNTIME&&!readonly;
 return Object.freeze({binding:'aligned',execution:'service',mutations:!readonly,
  betaAccess:beta?'service':'closed',betaManagement:beta,reason:'service'});
}
