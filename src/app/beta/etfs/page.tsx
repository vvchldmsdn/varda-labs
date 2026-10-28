import {requireBetaFixtureAccess,prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {getBetaEtfRead} from '@/lib/cairn-v2/server-etfs';
import {BetaEtfs} from '@/components/cairn-v2/beta-etfs';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireBetaFixtureAccess();return <BetaEtfs read={await getBetaEtfRead(await prepareBetaPageParams(await searchParams, '/beta/etfs'))}/>;}
