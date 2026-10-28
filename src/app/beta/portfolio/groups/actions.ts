'use server';
import {revalidatePath} from 'next/cache';
import {requireBetaAccountManagementAccess} from '@/lib/cairn-v2/server-management-access';
import {savePortfolioGroup,archivePortfolioGroup} from '@/app/portfolio/groups/actions';
import type {PortfolioGroupManagementActionState} from '@/lib/portfolio-group-management';
function complete(result:PortfolioGroupManagementActionState){if(result.status==='success')revalidatePath('/beta','layout');return result;}
export async function saveBetaGroup(previous:PortfolioGroupManagementActionState,data:FormData){await requireBetaAccountManagementAccess();return complete(await savePortfolioGroup(previous,data));}
export async function archiveBetaGroup(previous:PortfolioGroupManagementActionState,data:FormData){await requireBetaAccountManagementAccess();return complete(await archivePortfolioGroup(previous,data));}
