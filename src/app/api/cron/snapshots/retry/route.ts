import { NextResponse } from "next/server";
import { isAuthorizedAdminJob } from "@/lib/admin-auth";
import { runSnapshotRetry } from "@/lib/snapshots/retry-runner";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=180;
const headers={"Cache-Control":"no-store"};

export async function GET(request:Request) {
  if(!isAuthorizedAdminJob(request.headers)) return NextResponse.json({error:"Unauthorized"},{status:401,headers});
  if(new URL(request.url).searchParams.size) return NextResponse.json({error:"query_parameters_not_allowed"},{status:400,headers});
  if(process.env.MARKET_CYCLE_CRON_WRITE_ENABLED!=="true") return NextResponse.json({ok:false,status:"disabled"},{status:409,headers});
  const result=await runSnapshotRetry();
  return NextResponse.json(result,{status:result.status==="failed" ? 500 : result.ok ? 200 : 409,headers});
}
