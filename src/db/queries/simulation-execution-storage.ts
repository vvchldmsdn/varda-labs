import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { getTenantSqlClient } from "@/db/tenant-client";
import { decodePath, EXECUTION_POLICY as P, manifestOf, type PackedExecution, type Piece } from "@/lib/simulation-execution-codec";
import type { SimulationPathHandle } from "@/lib/simulation-path-detail";
import type { PathReadResult } from "@/lib/simulation-path-detail-store";
import type { StoredSimulationExecution } from "@/lib/simulation-storage-management";
const requestDeadline = new AsyncLocalStorage<AbortSignal>();
export function withExecutionDeadline<T>(work: () => Promise<T>) {
  return requestDeadline.run(AbortSignal.timeout(20_000), work);
}
export async function canAdmitSharedExecution(owner: string) {
  // Existing runs can be resumed, and this owner's expired/incomplete rows can
  // be pruned by beginSharedExecution. This is only an optimistic preflight:
  // the INSERT trigger still checks every service gate after that pruning.
  const [rows] = await transaction(owner, [{ sql: `select simulation_execution_admission() or exists(
    select 1 from simulation_executions where owner_user_id=$1::uuid and (
      (state in ('creating','ready') and expires_at>clock_timestamp())
      or expires_at<=clock_timestamp()
      or (state<>'ready' and created_at<clock_timestamp()-interval '30 minutes')
    )) as allowed`, params: [owner] }]);
  return rows[0]?.allowed === true;
}

/** Minimized owner-only metadata; never exports bindings, paths or inputs. */
export async function listStoredSharedExecutions(owner: string): Promise<StoredSimulationExecution[]> {
  const [rows] = await transaction(owner, [{ sql: `select id,model,(manifest->>'horizon')::int as horizon,state,
    (extract(epoch from created_at)*1000)::bigint as created,
    (extract(epoch from expires_at)*1000)::bigint as expires
    from simulation_executions where owner_user_id=$1::uuid order by created_at desc,id limit 3`, params: [owner] }]);
  return rows.map(row => ({ id: row.id, model: row.model, horizon: row.horizon, state: row.state,
    createdAt: Number(row.created), expiresAt: Number(row.expires) }));
}

/** Explicit user deletion; automatic rotation handles normal retention. */
export async function deleteStoredSharedExecution(owner: string, executionId: string) {
  const [rows] = await transaction(owner, [{ sql: "delete from simulation_executions where owner_user_id=$1::uuid and id=$2::uuid returning 1 as removed", params: [owner, executionId] }], true);
  return rows.length === 1;
}

// All private queries use the existing tenant HTTP transaction client. No process state.
async function transaction(owner: string, queries: { sql: string; params?: unknown[] }[], write = false) {
  const signal = requestDeadline.getStore() ?? AbortSignal.timeout(10_000);
  signal.throwIfAborted();
  const setup = 2 + Number(write);
  const rows = await getTenantSqlClient().transaction(tx => [
    tx.query("select set_config('app.current_user_id',$1,true),set_config('statement_timeout','15000',true),set_config('lock_timeout','4000',true)", [owner]),
    tx.query("select 1/(case when rolsuper or rolbypassrls then 0 else 1 end) as safe from pg_roles where rolname=current_user"),
    ...(write ? [tx.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`cairn.simulation.execution.v1:${owner}`])] : []),
    ...queries.map(q => tx.query(q.sql, q.params ?? [])),
  ], { isolationLevel: "ReadCommitted", readOnly: !write, fetchOptions: { signal } });
  return rows.slice(setup);
}
export async function beginSharedExecution(owner: string, p: PackedExecution) {
  const { common, chunks, ...rest } = p;
  const manifest = { ...rest, common: manifestOf(common), chunks: chunks.map(manifestOf) };
  const [, rows] = await transaction(owner, [
    { sql: "delete from simulation_executions where owner_user_id=$1::uuid and (expires_at<=clock_timestamp() or (state<>'ready' and created_at<clock_timestamp()-interval '30 minutes'))", params: [owner] },
    { sql: `with prior as materialized(select binding,state from simulation_executions where owner_user_id=$1::uuid and id=$2::uuid), added as (
      insert into simulation_executions(owner_user_id,id,binding,codec,projection,model,currency,manifest,common_data,reserved_bytes)
      select $1::uuid,$2::uuid,$3,$4,1,$5,$6,$7::jsonb,decode($8,'base64'),$9::bigint
      where investment_plan_tenant_active() and not exists(select 1 from prior)
      and not exists(select 1 from simulation_executions where owner_user_id=$1::uuid and binding=$3)
      and (select count(*) from simulation_executions where owner_user_id=$1::uuid)<${P.ownerCount + P.ownerInFlight}
      and (select coalesce(sum(reserved_bytes),0) from simulation_executions where owner_user_id=$1::uuid)+$9::bigint<=201326592
      and not exists(select 1 from simulation_executions where owner_user_id=$1::uuid and state='creating') returning id)
      select case when exists(select 1 from added) then 'creating' when exists(select 1 from prior where binding=$3 and state in ('creating','ready')) then (select state from prior) when exists(select 1 from prior) then 'conflict' else 'limit' end as status`, params: [owner,p.id,p.binding,P.codec,p.model,p.currency,JSON.stringify(manifest),common.data,p.bytes] },
  ], true);
  return rows[0]?.status as "creating" | "ready" | "conflict" | "limit";
}
export async function appendSharedExecution(owner: string, p: PackedExecution, chunks: Piece[]) {
  if (!chunks.length || chunks.length > P.batch) throw Error("batch_limit");
  const rows = await transaction(owner, chunks.map(c => ({ sql: `with e as materialized(select state,binding from simulation_executions where owner_user_id=$1::uuid and id=$2::uuid and expires_at>clock_timestamp()), old as materialized(select manifest from simulation_execution_chunks where owner_user_id=$1::uuid and execution_id=$2::uuid and chunk_index=$3), added as (
    insert into simulation_execution_chunks(owner_user_id,execution_id,chunk_index,manifest,data)
    select $1::uuid,$2::uuid,$3,$4::jsonb,decode($5,'base64') where exists(select 1 from e where state='creating' and binding=$6) and not exists(select 1 from old) returning chunk_index)
    select exists(select 1 from added) or (exists(select 1 from e where binding=$6) and exists(select 1 from old where manifest=$4::jsonb)) as ok`, params: [owner,p.id,c.index,JSON.stringify(manifestOf(c)),c.data,p.binding] })), true);
  if (rows.some(r => r[0]?.ok !== true)) throw Error("execution_conflict");
}
export async function finishSharedExecution(owner: string, p: PackedExecution): Promise<SimulationPathHandle> {
  const [, rows] = await transaction(owner, [
    { sql: "update simulation_executions set state='ready' where owner_user_id=$1::uuid and id=$2::uuid and binding=$3 and state='creating' and expires_at>clock_timestamp()", params:[owner,p.id,p.binding] },
    { sql: "select id,binding,model,currency,(extract(epoch from expires_at)*1000)::bigint as expires from simulation_executions where owner_user_id=$1::uuid and id=$2::uuid and binding=$3 and state='ready' and expires_at>clock_timestamp()", params:[owner,p.id,p.binding] },
  ], true);
  if (!rows[0]) throw Error("execution_unavailable");
  const r=rows[0]; return {executionId:r.id,binding:r.binding,model:r.model,currency:r.currency,preview:false,expiresAt:Number(r.expires)};
}
export async function saveSharedExecution(owner: string, p: PackedExecution) {
  let status: Awaited<ReturnType<typeof beginSharedExecution>>;
  try {
    status = await beginSharedExecution(owner, p);
  } catch (error) {
    // Admission is rechecked by the SQL trigger under the global budget lock.
    // Another request can consume capacity after the earlier read-only check.
    if (error instanceof Error && ["execution_service_limit", "execution_limit"].includes(error.message)) return { status: "limit" } as const;
    throw error;
  }
  if(status==='limit'||status==='conflict') return {status} as const;
  if(status==='creating') for(let i=0;i<p.chunks.length;i+=P.batch) await appendSharedExecution(owner,p,p.chunks.slice(i,i+P.batch));
  return {status:'ready' as const,handle:await finishSharedExecution(owner,p)};
}
/** A repeated render resumes the identical immutable execution without extending TTL. */
export async function saveRenderedExecution(owner: string, p: PackedExecution) {
  async function existing() {
    const [rows] = await transaction(owner,[{ sql: "select id from simulation_executions where owner_user_id=$1::uuid and binding=$2 and state in ('creating','ready') and expires_at>clock_timestamp() and (state='ready' or created_at>clock_timestamp()-interval '30 minutes') order by created_at,id limit 1", params:[owner,p.binding] }]);
    return rows[0]?.id as string | undefined;
  }
  const found=await existing();
  let result=await saveSharedExecution(owner,found?{...p,id:found}:p);
  if(result.status==='limit') { // Concurrent identical first render may have won admission.
    const resumed=await existing();
    if(resumed && resumed!==p.id) result=await saveSharedExecution(owner,{...p,id:resumed});
  }
  return result;
}
export async function readSharedExecution(owner: string, h: SimulationPathHandle, path: number): Promise<PathReadResult> {
  try {
    const [rows]=await transaction(owner,[{sql:"select binding,codec,projection,model,currency,state,expires_at<=clock_timestamp() as expired,(extract(epoch from expires_at)*1000)::bigint as expires,manifest from simulation_executions where owner_user_id=$1::uuid and id=$2::uuid",params:[owner,h.executionId]}]);
    const e=rows[0];
    if(!e) return {ok:false,status:404,error:'not_found'};
    if(e.binding!==h.binding||e.currency!==h.currency||e.model!==h.model||Number(e.expires)!==h.expiresAt||h.preview) return {ok:false,status:409,error:'execution_mismatch'};
    if(e.expired) return {ok:false,status:410,error:'execution_expired'};
    if(e.codec!==P.codec||e.projection!==P.projection) return {ok:false,status:422,error:'unsupported_version'};
    if(e.state!=='ready') return {ok:false,status:409,error:e.state==='creating'?'execution_preparing':'detail_unavailable'};
    if(!Number.isInteger(path)||path<0||path>=e.manifest.pathCount) return {ok:false,status:400,error:'invalid_path'};
    const index=Math.floor(path/P.group);
    const [pieces]=await transaction(owner,[{sql:`select e.expires_at<=clock_timestamp() as expired,e.state,
      case when e.state='ready' and e.expires_at>clock_timestamp() then encode(e.common_data,'base64') end as common,
      case when e.state='ready' and e.expires_at>clock_timestamp() then encode(c.data,'base64') end as data,c.manifest
      from simulation_executions e left join simulation_execution_chunks c on c.owner_user_id=e.owner_user_id and c.execution_id=e.id and c.chunk_index=$4
      where e.owner_user_id=$1::uuid and e.id=$2::uuid and e.binding=$3`,params:[owner,h.executionId,h.binding,index]}]);
    const piece=pieces[0];
    if(!piece) return {ok:false,status:404,error:'not_found'};
    if(piece.expired) return {ok:false,status:410,error:'execution_expired'};
    if(piece.state!=='ready') return {ok:false,status:409,error:'execution_preparing'};
    // The immutable manifest binds the exact compressed and uncompressed bytes.
    if(JSON.stringify(piece.manifest)!==JSON.stringify(e.manifest.chunks[index])) return {ok:false,status:422,error:'detail_corrupt'};
    try {
      const detail=decodePath(h,path,{...e.manifest.common,data:piece.common},{...piece.manifest,data:piece.data});
      return {ok:true,detail};
    } catch { return {ok:false,status:422,error:'detail_corrupt'}; }
  } catch { return {ok:false,status:503,error:'detail_unavailable'}; }
}
export async function deleteSharedExecution(owner: string, h: SimulationPathHandle) {
  const [rows]=await transaction(owner,[{sql:"delete from simulation_executions where owner_user_id=$1::uuid and id=$2::uuid and binding=$3 returning id",params:[owner,h.executionId,h.binding]}],true);
  return rows.length===1;
}
