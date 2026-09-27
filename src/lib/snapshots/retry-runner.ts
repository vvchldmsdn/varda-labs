import "server-only";
import { runDailySnapshotJob } from "@/lib/snapshots/daily-job";
import { runNativeDailySnapshotJob } from "@/lib/snapshots/native-daily-job";
import { resolveSnapshotCycle } from "./market-calendar";
import { snapshotDeadline } from "./write-context";

/** Drain persisted due work only. No market collection, provider lease, or
 * provider request belongs to this independently callable wake-up path. */
export async function runSnapshotRetry(now=new Date()) {
  const snapshotDate=resolveSnapshotCycle(now).snapshotDate;
  return snapshotDeadline.run(Date.now()+120000,async()=>{
    const options={dryRun:false,durable:true,discover:false,snapshotDate};
    const failed={targetCount:0,writtenCount:0,failedCount:1,blockedCount:0};
    // Each family can progress even when the other family's query fails.
    const legacy=await runDailySnapshotJob(options).catch(()=>failed);
    const native=await runNativeDailySnapshotJob(options).catch(()=>failed);
    const failedCount=legacy.failedCount+native.failedCount;
    const blockedCount=legacy.blockedCount+native.blockedCount;
    return {ok:failedCount===0&&blockedCount===0,status:failedCount ? "failed" as const : blockedCount ? "blocked" as const : "completed" as const,
      snapshotDate,legacy,native,providerRequests:0,secretsIncluded:false};
  });
}
