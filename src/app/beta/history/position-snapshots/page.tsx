import {requireBetaFixtureAccess,prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {getBetaSnapshotRead} from '@/lib/cairn-v2/server-snapshots';
import {BetaSnapshots} from '@/components/cairn-v2/beta-snapshots';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireBetaFixtureAccess();return <BetaSnapshots read={await getBetaSnapshotRead(await prepareBetaPageParams(await searchParams, '/beta/history/position-snapshots'),'positions')}/>;}
