import {prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {requireAlignedBackendSource} from '@/lib/shared-backend/selection';
import {getPlanWorkspace} from '@/lib/cairn-v2/server-remaining-workspace';
import {BetaRemainingWorkspace} from '@/components/cairn-v2/beta-remaining-workspace';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireAlignedBackendSource();return <BetaRemainingWorkspace {...await getPlanWorkspace(await prepareBetaPageParams(await searchParams, '/beta/plans'))}/>;}
