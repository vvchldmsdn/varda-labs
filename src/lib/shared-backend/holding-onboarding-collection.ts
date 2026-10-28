import 'server-only';
import {requireAlignedBackendSource} from './selection';
import {assessSharedBackendRuntime} from './runtime-policy';
import {enqueueMarketCollection as originalEnqueue} from '../market-data/collection-queue';
import {scheduleMarketCollection as originalSchedule} from '../market-data/collection-worker';

export const HOLDING_COLLECTION_UNCONNECTED = 'holding_onboarding_collection_unconnected' as const;
type CollectionInput = Readonly<{kind:'live';ticker:string;market:string;currency:string}>;

// This server-only switch admits the preserved durable collector, including its
// history, FX, latest-close and configured Twelve Data worker effects. It never
// proves session/account authority; the preserved onboarding writer checks those
// before entering this internal port. Reads, builds and imports never drain work.
function assertCollectionEnabled() {
  const runtime=assessSharedBackendRuntime({
    source:process.env.CAIRN_SHARED_BACKEND_SOURCE,
    runtime:process.env.CAIRN_SHARED_BACKEND_RUNTIME,
    betaRuntime:process.env.CAIRN_BETA_RUNTIME,
    databaseUrl:process.env.DATABASE_URL,
    liveReadOnly:process.env.CAIRN_LIVE_READONLY,
    nodeEnv:process.env.NODE_ENV,
    enabled:process.env.CAIRN_BETA_FIXTURES,
    vercel:process.env.VERCEL,
    vercelEnv:process.env.VERCEL_ENV,
    host:null,forwardedHost:null,
  });
  if(process.env.CAIRN_HOLDING_COLLECTION_ENABLED!=='1'||
    runtime.binding!=='aligned'||runtime.execution!=='service'||!runtime.mutations) {
    throw new Error(HOLDING_COLLECTION_UNCONNECTED);
  }
}

export async function enqueueMarketCollection(inputs:readonly CollectionInput[]) {
  await requireAlignedBackendSource();
  assertCollectionEnabled();
  return originalEnqueue(inputs);
}
// The source writer awaits the durable enqueue before this synchronous call.
// Original next/server.after scheduling is reused unchanged; no inline drain.
export function scheduleMarketCollection() {
  assertCollectionEnabled();
  return originalSchedule();
}
