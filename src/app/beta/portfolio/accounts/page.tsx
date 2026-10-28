import {requireBetaFixtureAccess,prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {getBetaAccountRead} from '@/lib/cairn-v2/server-accounts';
import {BetaAccounts} from '@/components/cairn-v2/beta-accounts';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  await requireBetaFixtureAccess();
  return <BetaAccounts read={await getBetaAccountRead(await prepareBetaPageParams(await searchParams, '/beta/portfolio/accounts'))}/>;
}
