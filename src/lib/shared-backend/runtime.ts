import 'server-only';
import {headers} from 'next/headers';
import {assessSharedBackendRuntime,SHARED_BACKEND_SOURCE} from './runtime-policy';
export async function readSharedBackendRuntime(){
 const input={
  source:process.env.CAIRN_SHARED_BACKEND_SOURCE,runtime:process.env.CAIRN_SHARED_BACKEND_RUNTIME,
  betaRuntime:process.env.CAIRN_BETA_RUNTIME,databaseUrl:process.env.DATABASE_URL,
  liveReadOnly:process.env.CAIRN_LIVE_READONLY,nodeEnv:process.env.NODE_ENV,
  enabled:process.env.CAIRN_BETA_FIXTURES,vercel:process.env.VERCEL,vercelEnv:process.env.VERCEL_ENV,
 };
 // Only the preserved local fixture gate depends on request host. The existing
 // default backend and shared service selection do not gain a headers/CLI dependency.
 if(input.runtime!==undefined||input.nodeEnv!=='development'||input.enabled!=='1'||
   input.vercel||input.vercelEnv||(input.source!==undefined&&input.source!==SHARED_BACKEND_SOURCE))
  return assessSharedBackendRuntime({...input,host:null,forwardedHost:null});
 const requestHeaders=await headers();
 return assessSharedBackendRuntime({...input,host:requestHeaders.get('host'),forwardedHost:requestHeaders.get('x-forwarded-host')});
}
