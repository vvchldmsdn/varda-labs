import {requireBetaFixtureAccess,prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {getBetaLabRead} from '@/lib/cairn-v2/server-lab';
import {BetaLab} from '@/components/cairn-v2/beta-lab';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireBetaFixtureAccess();return <BetaLab read={await getBetaLabRead(await prepareBetaPageParams(await searchParams, '/beta/investment-lab'))}/>;}
