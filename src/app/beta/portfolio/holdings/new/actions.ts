'use server';
import {revalidatePath} from 'next/cache';
import {requireBetaAccountManagementAccess} from '@/lib/cairn-v2/server-management-access';
import {createHoldingOnboarding,createHoldingBatch} from '@/app/portfolio/holdings/new/actions';
import type {SharedHoldingOnboardingActionState} from '@/lib/shared-backend/holding-onboarding';
export async function createBetaHoldingOnboarding(previous:SharedHoldingOnboardingActionState,data:FormData){await requireBetaAccountManagementAccess();const result=await createHoldingOnboarding(previous,data);if(result.status==='success')revalidatePath('/beta','layout');return result;}

export async function createBetaHoldingBatch(previous: import('@/lib/holding-batch').HoldingBatchState, data: FormData) {
 await requireBetaAccountManagementAccess();
 const result = await createHoldingBatch(previous, data);
 if (result.results.some(row => row.result.status === 'success')) revalidatePath('/beta', 'layout');
 return result;
}
