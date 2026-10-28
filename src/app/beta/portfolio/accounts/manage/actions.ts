'use server';
import { revalidatePath } from 'next/cache';
import type { AccountManagementActionState } from '@/lib/account-management';
import { createAccount, updateAccount, archiveAccount, restoreAccount } from '@/app/portfolio/accounts/actions';
import { requireBetaAccountManagementAccess } from '@/lib/cairn-v2/server-management-access';

// Call the original action exactly once. Its session, owner, validation, CAS,
// atomic SQL, and original-front invalidation remain authoritative.
export async function createBetaAccount(previous: AccountManagementActionState, data: FormData) {
  await requireBetaAccountManagementAccess();
  return complete(await createAccount(previous, data));
}
export async function updateBetaAccount(previous: AccountManagementActionState, data: FormData) {
  await requireBetaAccountManagementAccess();
  return complete(await updateAccount(previous, data));
}
export async function archiveBetaAccount(previous: AccountManagementActionState, data: FormData) {
  await requireBetaAccountManagementAccess();
  return complete(await archiveAccount(previous, data));
}
export async function restoreBetaAccount(previous: AccountManagementActionState, data: FormData) {
  await requireBetaAccountManagementAccess();
  return complete(await restoreAccount(previous, data));
}
function complete(result: AccountManagementActionState) {
  if (result.status === 'success') revalidatePath('/beta', 'layout');
  return result;
}
