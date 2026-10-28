import {prepareBetaPageParams} from '@/lib/cairn-v2/server-access';
import { requireBetaAccountManagementAccess } from '@/lib/cairn-v2/server-management-access';
import { getBetaAccountManagementRead } from '@/lib/cairn-v2/server-account-management';
import { BetaAccountManagement } from '@/components/cairn-v2/beta-account-management';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireBetaAccountManagementAccess();
  return <BetaAccountManagement read={await getBetaAccountManagementRead(await prepareBetaPageParams(await searchParams, '/beta/portfolio/accounts/manage'))} />;
}
