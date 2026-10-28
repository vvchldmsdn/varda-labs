import 'server-only';
import type { ComponentProps } from 'react';
import { resolveCurrentTenantContext } from '@/lib/auth/current-tenant-context';
import { readRecoveredReturnCurve } from '@/db/queries/period-return-recovery';
import { HistoryTimeExplorer } from '@/components/history/history-time-explorer';
import { PortfolioHistoryChart } from '@/components/home/portfolio-history-chart';
async function readCurve(accountId?: string) {
  if (!accountId) return null;
  const session = await resolveCurrentTenantContext();
  return session.ok ? readRecoveredReturnCurve(session.tenantContext, accountId) : null;
}
export async function RecoveredHistoryExplorer({ accountId, ...props }: ComponentProps<typeof HistoryTimeExplorer> & { accountId?: string }) {
  return <HistoryTimeExplorer {...props} recoveredReturn={await readCurve(accountId)}/>;
}
export async function RecoveredPortfolioHistoryChart({ accountId, ...props }: ComponentProps<typeof PortfolioHistoryChart> & { accountId?: string }) {
  return <PortfolioHistoryChart {...props} recoveredReturn={await readCurve(accountId)}/>;
}
