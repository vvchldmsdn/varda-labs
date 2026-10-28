import {requireBetaFixtureAccess,prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {getBetaEventRead} from '@/lib/cairn-v2/server-events';
import {BetaEvents} from '@/components/cairn-v2/beta-events';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireBetaFixtureAccess();return <BetaEvents read={await getBetaEventRead(await prepareBetaPageParams(await searchParams, '/beta/history/events'))}/>;}
