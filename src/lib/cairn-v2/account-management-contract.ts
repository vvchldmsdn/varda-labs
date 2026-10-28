import type { AccountManagementModelResult } from '../../db/queries/account-management';
import { accountsHref, accountsKey, type AccountsRead } from './account-contract';
import { betaReadHref, type BetaContext } from './navigation';

// Unlike the read-only account list, a form needs a target UUID and CAS version.
// These are submitted to the original session writer, never treated as authority.
export type ManagedAccount = {
  id: string; name: string; accountType: string; currency: string;
  isActive: boolean; updatedAt: string;
  activeHoldingCount: number; openGroupReferenceCount: number;
};
export type AccountManagementRead = AccountsRead & { managementRows: ManagedAccount[] };

export function managementKey(context: BetaContext) {
  return JSON.stringify(['account-management-v1', accountsKey(context)]);
}
export function managementHref(context: BetaContext, epoch?: string | null) {
  const url = new URL(accountsHref(context), 'https://beta.invalid');
  url.pathname = '/beta/portfolio/accounts/manage';
  url.hash = 'account-management';
  return betaReadHref(url.pathname + url.search + url.hash, epoch);
}
export function adaptAccountManagement(read: AccountsRead, source?: AccountManagementModelResult): AccountManagementRead {
  const managementRows: ManagedAccount[] = (read.state === 'ready' || read.state === 'empty') && source?.state === 'ready'
    ? source.accounts.map(row => ({
      id: row.id, name: row.name, accountType: row.accountType, currency: row.currency,
      isActive: row.isActive, updatedAt: row.updatedAt,
      activeHoldingCount: row.activeHoldingCount, openGroupReferenceCount: row.openGroupReferenceCount,
    })) : [];
  return { ...read, managementRows, queryKey: managementKey(read.context) };
}
