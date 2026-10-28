import 'server-only';
import {writeSessionHoldingStateCorrection as preservedCorrection} from '@/lib/holding-state-correction-write';
import {archiveSessionHolding as preservedArchive,restoreSessionHolding as preservedRestore} from '@/lib/holding-lifecycle-write';
import {isAlignedBackendSourceSelected} from './selection';
import {getReadOnlyTenantHoldings as preservedManagedRead} from '@/db/queries/tenant-holdings';
export type {TenantHoldingQueryResult as SharedManagedHoldingsResult} from '../../db/queries/tenant-holdings';
// One selected original writer per action. Candidate source remains local,
// synthetic-only; missing selection preserves the accepted baseline backend.
export async function writeSessionHoldingStateCorrection(data:FormData) {
  await isAlignedBackendSourceSelected();
  return preservedCorrection(data);
}
export async function archiveSessionHolding(data:FormData) {
  await isAlignedBackendSourceSelected();
  return preservedArchive(data);
}
export async function restoreSessionHolding(data:FormData) {
  await isAlignedBackendSourceSelected();
  return preservedRestore(data);
}
// Management-only read preserves the original candidate's microsecond CAS.
// The accepted read-only beta route keeps its existing query and DTO untouched.
export async function getSharedManagedHoldings(args:Parameters<typeof preservedManagedRead>[0]) {
  await isAlignedBackendSourceSelected();
  return preservedManagedRead(args);
}