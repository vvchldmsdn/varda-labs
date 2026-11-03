import "server-only";
import { requiresNativePortfolioSurface } from "@/db/queries/native-portfolio-ledger";
import { getTrackedCurrencyEvidence } from "@/db/queries/currency-tracked-portfolio";
import { buildTrackedCurrencyReports } from "@/lib/server/currency-tracked-reports";
import type { DashboardData } from "@/lib/portfolio-dashboard";
import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { TenantContext } from "@/lib/session-resolver-contract";
import type { Currency } from "@/lib/money";
import type { OriginalCurrentValuePresentation } from "./current-value-presentation";
import type { InvestmentReturn } from "./investment-return";

/** Mirror the original home presentation choice after session/scope admission.
 * Existing readers retain all owner, quote, FX, date and exclusion policies. */
export async function readOriginalCurrentValue({tenantContext,scope,currency,dashboard}:{tenantContext:TenantContext;scope:PortfolioAnalysisScope;currency:Currency;dashboard:DashboardData & {investmentReturn?:InvestmentReturn}}):Promise<OriginalCurrentValuePresentation> {
  const native=await requiresNativePortfolioSurface(tenantContext,scope);
  if(native || currency === "USD") {
    const evidence=await getTrackedCurrencyEvidence(tenantContext,scope,currency,{asOf:new Date(dashboard.generatedAt),collect:false,investmentsOnly:true});
    const reports=buildTrackedCurrencyReports(evidence);
    if(!reports[currency].current)return {kind:"unavailable"};
    return {kind:"tracked",evidence,reports};
  }
  return {kind:"legacy",data:{generatedAt:dashboard.generatedAt,totalValueKrw:dashboard.totalValueKrw,usdKrwRate:dashboard.usdKrwRate,investmentReturn:dashboard.investmentReturn,
    holdings:dashboard.holdings.map(({name,ticker,account,market,currency,quantity,currentPrice,currentWeight,assetType,groupName,valueKrw,priceAsOf,priceFetchedAt,priceSource})=>({name,ticker,account,market,currency,quantity,currentPrice,currentWeight,assetType,groupName,valueKrw,priceAsOf,priceFetchedAt,priceSource}))}};
}
