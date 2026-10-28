import {prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {requireAlignedBackendSource} from '@/lib/shared-backend/selection';
import {getBetaTargetEditorRead} from '@/lib/cairn-v2/server-target-editor';
import {BetaTargetEditor} from '@/components/cairn-v2/beta-target-editor';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireAlignedBackendSource();return <BetaTargetEditor read={await getBetaTargetEditorRead(await prepareBetaPageParams(await searchParams, '/beta/portfolio/targets'))}/>;}
