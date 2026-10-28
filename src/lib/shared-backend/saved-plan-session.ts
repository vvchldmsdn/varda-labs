import 'server-only';
import {createHash} from 'node:crypto';
import {readCurrentSessionSubject} from '@/lib/auth/current-session-subject';
import {resolveCurrentTenantContext} from '@/lib/auth/current-tenant-context';
export async function savedPlanSession(){const subject=await readCurrentSessionSubject();if(subject.state!=='authenticated')return {ok:false as const,status:401,error:'sign_in_required'};const tenant=await resolveCurrentTenantContext();if(!tenant.ok)return {ok:false as const,status:tenant.failure.httpStatus,error:tenant.failure.code};return {ok:true as const,key:createHash('sha256').update(`investment-plans\0${subject.provider}\0${subject.providerSubject}\0${tenant.tenantContext.ownerUserId}`).digest('hex')}}
