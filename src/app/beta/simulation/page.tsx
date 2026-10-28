import {requireBetaFixtureAccess,prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {getBetaSimulationRead} from '@/lib/cairn-v2/server-simulation';
import {BetaSimulation} from '@/components/cairn-v2/beta-simulation';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {await requireBetaFixtureAccess();return <BetaSimulation read={await getBetaSimulationRead(await prepareBetaPageParams(await searchParams, '/beta/simulation'))} />;}
