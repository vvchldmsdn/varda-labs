import "server-only";
import { CurrencyPortfolioSurfaceClient, type CurrencyPortfolioSurfaceProps } from "@/components/currency-portfolio-surface-client";
import { buildTrackedCurrencyReports } from "@/lib/server/currency-tracked-reports";

export type { CurrencySurface } from "@/components/currency-portfolio-surface-client";

export function CurrencyPortfolioSurface(props: CurrencyPortfolioSurfaceProps) {
  const reports = props.evidence ? buildTrackedCurrencyReports(props.evidence) : undefined;
  return <CurrencyPortfolioSurfaceClient {...props} reports={reports} />;
}
