import 'server-only';
import { writeSessionPortfolioTargetPolicy as preservedWrite } from '@/lib/portfolio-target-policy-write';
import { getReadOnlyTenantPortfolioTargetPolicyModel as preservedRead } from '@/db/queries/portfolio-target-policy';
import { isAlignedBackendSourceSelected } from './selection';
export type { PortfolioTargetPolicyActionState } from '../portfolio-target-policy-write';
export async function writeSessionPortfolioTargetPolicy(data: FormData) {
  await isAlignedBackendSourceSelected();
  return preservedWrite(data);
}
export async function getSharedPortfolioTargetPolicyModel(args: Parameters<typeof preservedRead>[0]) {
  await isAlignedBackendSourceSelected();
  return preservedRead(args);
}

export async function getSharedTargetServiceDate(now = new Date()) {
  await isAlignedBackendSourceSelected();
  const calendar = await import('@/lib/snapshots/market-calendar');
  return calendar.resolveSnapshotCycle(now).snapshotDate;
}