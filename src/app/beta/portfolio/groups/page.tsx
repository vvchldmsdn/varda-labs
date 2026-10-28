import {prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {requireBetaAccountManagementAccess} from '@/lib/cairn-v2/server-management-access';
import {getBetaOwnedManagementRead} from '@/lib/cairn-v2/server-owned-management';
import {BetaOwnedManagement} from '@/components/cairn-v2/beta-owned-management';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireBetaAccountManagementAccess();return <BetaOwnedManagement read={await getBetaOwnedManagementRead('groups',await prepareBetaPageParams(await searchParams, '/beta/portfolio/groups'))}/>;}
