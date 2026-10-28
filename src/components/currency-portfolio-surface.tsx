import "server-only";
import { resolveCurrentTenantContext } from '@/lib/auth/current-tenant-context';
import { readRecoveredReturnCurve } from '@/db/queries/period-return-recovery';
import { CurrencyPortfolioSurfaceClient, type CurrencyPortfolioSurfaceProps } from "@/components/currency-portfolio-surface-client";
import { buildTrackedCurrencyReports } from "@/lib/server/currency-tracked-reports";

export type { CurrencySurface } from "@/components/currency-portfolio-surface-client";

export async function CurrencyPortfolioSurface(props: CurrencyPortfolioSurfaceProps) {
  const tenant = (props.surface === 'home' || props.surface === 'history') && props.selectedScope.kind === 'account' ? await resolveCurrentTenantContext() : null;
  const recoveredReturn = tenant?.ok && props.selectedScope.kind === 'account' ? await readRecoveredReturnCurve(tenant.tenantContext, props.selectedScope.accountId) : null;
  const reports = props.evidence ? buildTrackedCurrencyReports(props.evidence) : undefined;
  return <CurrencyPortfolioSurfaceClient {...props} reports={reports} recoveredReturn={recoveredReturn} />;
}
