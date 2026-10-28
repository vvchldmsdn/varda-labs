import type {Metadata} from 'next';
import {requireBetaFixtureAccess,betaUsesSharedService} from '@/lib/cairn-v2/server-access';
import {betaAccountManagementAvailable} from '@/lib/cairn-v2/server-management-access';
import {resolveCurrentTenantContext} from '@/lib/auth/current-tenant-context';
import {PortfolioReadAccessBoundary} from '@/components/portfolio-read-access-boundary';
import {BetaProvider} from '@/components/cairn-v2/beta-provider';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Cairn Labs · 개발용 베타',robots:{index:false,follow:false}};
export default async function BetaLayout({children}:{children:React.ReactNode}){
 await requireBetaFixtureAccess();
 if(await betaUsesSharedService()){
  const resolution=await resolveCurrentTenantContext();
  if(!resolution.ok)return <PortfolioReadAccessBoundary title="Cairn 베타" resolution={resolution}
   description="기존 서비스와 같은 로그인과 소유권을 확인합니다."
   closedMessage="활성 사용자와 본인 소유 범위를 확인하기 전에는 금융 자료를 열지 않습니다."/>;
 }
 return <BetaProvider existingCrudAvailable={await betaAccountManagementAvailable()}>{children}</BetaProvider>;
}
