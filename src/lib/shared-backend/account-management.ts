import 'server-only';
import * as preserved from '@/lib/account-management-write';
import { isAlignedBackendSourceSelected } from './selection';
// Same selected writer for both fronts; default and gated failures do not load
// the candidate backend, and no operation calls both source versions.
export async function createSessionAccount(data: FormData) {
  await isAlignedBackendSourceSelected();
  return preserved.createSessionAccount(data);
}
export async function updateSessionAccount(data: FormData) {
  await isAlignedBackendSourceSelected();
  return preserved.updateSessionAccount(data);
}
export async function archiveSessionAccount(data: FormData) {
  await isAlignedBackendSourceSelected();
  return preserved.archiveSessionAccount(data);
}
export async function restoreSessionAccount(data: FormData) {
  await isAlignedBackendSourceSelected();
  return preserved.restoreSessionAccount(data);
}
