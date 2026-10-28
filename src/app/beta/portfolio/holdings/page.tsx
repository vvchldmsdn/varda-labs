import {requireBetaFixtureAccess,prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {getBetaHoldingRead} from '@/lib/cairn-v2/server-holdings';
import {BetaHoldings} from '@/components/cairn-v2/beta-holdings';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await requireBetaFixtureAccess();
  return <BetaHoldings read={await getBetaHoldingRead(await prepareBetaPageParams(await searchParams, '/beta/portfolio/holdings'))}/>;
}
