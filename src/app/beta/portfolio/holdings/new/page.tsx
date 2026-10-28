import {prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import {requireBetaAccountManagementAccess} from '@/lib/cairn-v2/server-management-access';
import {getBetaHoldingOnboardingRead} from '@/lib/cairn-v2/server-onboarding';
import {BetaHoldingOnboarding} from '@/components/cairn-v2/beta-holding-onboarding';
import {readSharedBackendRuntime} from '@/lib/shared-backend/runtime';
import {onboardingCollectionVisible} from '@/lib/cairn-v2/onboarding-presentation';
import {getKisProviderPolicy} from '@/lib/market-data/providers/kis';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){await requireBetaAccountManagementAccess();const runtime=await readSharedBackendRuntime();return <BetaHoldingOnboarding collectionEnabled={onboardingCollectionVisible(getKisProviderPolicy().configured,runtime)} read={await getBetaHoldingOnboardingRead(await prepareBetaPageParams(await searchParams, '/beta/portfolio/holdings/new'))}/>;}
