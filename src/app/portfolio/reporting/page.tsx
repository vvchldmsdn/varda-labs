import { redirect } from "next/navigation";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getTrackedCurrencyEvidence } from "@/db/queries/currency-tracked-portfolio";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import { CurrencyTrackedView } from "@/components/currency-tracked-view";
import { trackedCurrencyFixture } from "@/lib/currency-tracked-fixture";
import { resolveAdditionalContributionPolicyParameters } from "@/lib/additional-contribution-policy-input";
export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio valuation | CAIRN LABS", robots: { index: false, follow: false } };
export default async function ReportingPage({ searchParams }: { searchParams: Promise<{ currency?: string; preview?: string; scope?: string }> }) {
  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "currency") return <><SecondaryPageHeader /><CurrencyTrackedView key={params.currency} evidence={{ ...trackedCurrencyFixture(), reporting: params.currency === "USD" ? "USD" : "KRW" }} contributionPolicy={resolveAdditionalContributionPolicyParameters()} hideCurrencyControl /></>;
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) redirect("/auth/sign-in");
  const context = await getReadOnlyTenantPortfolioAnalysisScopeContext({ scope: params.scope, tenantContext: resolution.tenantContext });
  if (context.state !== "ready" || context.resolution.state !== "resolved") return <PortfolioAnalysisScopeBoundary basePath="/portfolio/reporting" context={context} title="통화별 평가" titleEn="Portfolio valuation" />;
  const evidence = await getTrackedCurrencyEvidence(resolution.tenantContext, context.resolution.scope, params.currency === "USD" ? "USD" : "KRW");
  return <><SecondaryPageHeader /><CurrencyTrackedView key={evidence.reporting} evidence={evidence} contributionPolicy={evidence.contributionPolicy} hideCurrencyControl /></>;
}
