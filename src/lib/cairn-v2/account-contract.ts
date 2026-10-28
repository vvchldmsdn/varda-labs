import type { AccountManagementModelResult } from '../../db/queries/account-management';
import type { PortfolioAnalysisScope } from '../portfolio-analysis-scope';
import { betaHref, betaReadHref, type BetaContext } from './navigation';

// A response-local row key is not an account identity, authorization or storage key.
export type AccountsRow = {
  key: string;
  name: string;
  accountType: string;
  currency: string;
  isActive: boolean;
  updatedAt: string;
  activeHoldingCount: number;
  openGroupReferenceCount: number;
  // Only the already admitted, active owned catalog can supply a continuation.
  // Archived accounts remain visible here but cannot enter active holdings reads.
  holdingsScopeKey: string | null;
};
export type AccountsRead = {
  context: BetaContext;
  state: 'ready' | 'empty' | 'loading' | 'unauthorized' | 'unavailable';
  message: string;
  rows: AccountsRow[];
  scopes: { key: string; label: string; detail: string }[];
  // Membership-reference service cycle, not a valuation or price observation date.
  serviceDate: string | null;
  queryKey?: string;
  readReceipt?: string;
  readEpoch?: string;
  readAt?: string;
};

export function blankAccounts(context: BetaContext, state: AccountsRead['state'], message: string): AccountsRead {
  return { context, state, message, rows: [], scopes: [], serviceDate: null };
}

export function accountsKey(context: BetaContext) {
  return JSON.stringify([context.mode, context.scope, context.currency]);
}

export function accountsHref(context: BetaContext, epoch?: string | null) {
  const url = new URL(betaHref('/beta/portfolio/structure', context), 'https://beta.invalid');
  url.pathname = '/beta/portfolio/accounts';
  url.hash = 'account-summary';
  return betaReadHref(url.pathname + url.search + url.hash, epoch);
}

export function adaptAccounts(
  base: AccountsRead,
  result: AccountManagementModelResult,
  catalog: readonly PortfolioAnalysisScope[],
): AccountsRead {
  if (result.state === 'unavailable') {
    return { ...base, state: 'unavailable', rows: [], message: '계좌 현황 읽기 실패 · 이전 결과나 예시로 대체하지 않습니다' };
  }
  // The original model reads the owner's entire account reference. Never silently
  // filter it by the admitted shell scope or add balances from another reader.
  const rows: AccountsRow[] = result.accounts.map((row, index) => {
    const scope = row.isActive ? catalog.find(candidate => candidate.kind === 'account' && candidate.accountId === row.id && candidate.accountCode === row.code) : undefined;
    return {
      key: 'row-' + (index + 1),
      name: row.name,
      accountType: row.accountType,
      currency: row.currency,
      isActive: row.isActive,
      updatedAt: row.updatedAt,
      activeHoldingCount: row.activeHoldingCount,
      openGroupReferenceCount: row.openGroupReferenceCount,
      holdingsScopeKey: scope?.key ?? null,
    };
  });
  return {
    ...base, rows, state: rows.length ? 'ready' : 'empty',
    message: rows.length ? '본인 전체 계좌 현황 · 상단 조회 범위로 계좌 목록을 제한하지 않습니다' : '본인 소유 범위에서 읽힌 계좌가 없습니다',
  };
}
