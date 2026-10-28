import 'server-only';
import * as preserved from '@/lib/portfolio-group-management-write';
import { getReadOnlyTenantPortfolioGroupManagementModel } from '@/db/queries/portfolio-group-management';
import { isAlignedBackendSourceSelected } from './selection';
// Both frontends call this facade. Candidate selection retains the existing
// exact synthetic-only gate; no call executes both writer versions.
export async function writeSessionPortfolioGroup(data: FormData) {
  await isAlignedBackendSourceSelected();
  return preserved.writeSessionPortfolioGroup(data);
}
export async function archiveSessionPortfolioGroup(data: FormData) {
  await isAlignedBackendSourceSelected();
  return preserved.archiveSessionPortfolioGroup(data);
}
// The query and its projector are byte-identical in the two source baselines.
// Reuse the preserved source rather than introducing a duplicate query module.
export async function getSharedPortfolioGroupManagementModel(args: Parameters<typeof getReadOnlyTenantPortfolioGroupManagementModel>[0]) {
  await isAlignedBackendSourceSelected();
  return getReadOnlyTenantPortfolioGroupManagementModel(args);
}
export async function getSharedGroupServiceDate(now = new Date()) {
  await isAlignedBackendSourceSelected();
  const calendar = await import('@/lib/snapshots/market-calendar');
  return calendar.resolveSnapshotCycle(now).snapshotDate;
}