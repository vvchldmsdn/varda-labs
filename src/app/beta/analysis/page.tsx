import {requireBetaFixtureAccess,prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {getBetaAnalysisRead} from '@/lib/cairn-v2/server-analysis';
import {BetaAnalysis} from '@/components/cairn-v2/beta-analysis';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 await requireBetaFixtureAccess();
 return <BetaAnalysis read={await getBetaAnalysisRead(await prepareBetaPageParams(await searchParams, '/beta/analysis'))} />;
}
