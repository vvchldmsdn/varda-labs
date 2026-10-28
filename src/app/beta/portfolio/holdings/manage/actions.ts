'use server';
import {revalidatePath} from 'next/cache';
import {requireBetaAccountManagementAccess} from '@/lib/cairn-v2/server-management-access';
import {correctHoldingState,archiveHolding,restoreHolding} from '@/app/portfolio/holdings/actions';
import type {HoldingStateCorrectionActionState} from '@/lib/holding-state-correction';
import type {HoldingLifecycleActionState} from '@/lib/holding-lifecycle';
function complete<T extends {status:string}>(result:T){if(result.status==='success')revalidatePath('/beta','layout');return result;}
export async function correctBetaHolding(previous:HoldingStateCorrectionActionState,data:FormData){await requireBetaAccountManagementAccess();return complete(await correctHoldingState(previous,data));}
export async function archiveBetaHolding(previous:HoldingLifecycleActionState,data:FormData){await requireBetaAccountManagementAccess();return complete(await archiveHolding(previous,data));}
export async function restoreBetaHolding(previous:HoldingLifecycleActionState,data:FormData){await requireBetaAccountManagementAccess();return complete(await restoreHolding(previous,data));}
