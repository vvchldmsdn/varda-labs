import { localizedMetadata } from "@/lib/i18n/server";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { PortfolioTargetPolicyView } from "@/components/portfolio-target-policy-view";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "목표비중 | VARDA LABS" }, "Target weights | VARDA LABS");
}

type PortfolioTargetsPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
    from?: string | string[];
    amount?: string | string[];
    preview?: string | string[];
  }>;
};

export default async function PortfolioTargetsPage({ searchParams }: PortfolioTargetsPageProps) {
  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "design") {
    const { buildAdditionalContributionDesignPreview } = await import("@/lib/additional-contribution-design-preview");
    const design = buildAdditionalContributionDesignPreview({ amountKrw: 3_000_000, scopeInput: params.scope });
    return <PortfolioTargetPolicyView selectedScope={design.selectedScope} scopes={design.scopes} serviceDate={design.preview.serviceDate}
      rows={design.preview.rows.map(row => ({ accountName: row.accountName, assetName: row.name, market: row.market ?? "", currency: row.currency ?? "", ticker: row.ticker, buyability: "buyable", currentValueKrw: row.currentValueKrw, targetWeightBps: Math.round(row.targetWeightPct * 100) }))}
      universeHash="design-preview-not-a-policy" isReady policyStatus="available" approvalRevision={1} from={params.from} amount={params.amount} isDesignPreview />;
  }

  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return <PortfolioReadAccessBoundary
      closedMessage="로그인과 계정 소유권이 확인되기 전에는 목표비중을 읽거나 저장하지 않습니다."
      closedMessageEn="Target weights cannot be read or saved until sign-in and account ownership are verified."
      description="계좌와 자산그룹별로 사용자가 직접 정한 목표비중을 관리합니다."
      descriptionEn="Manage your own target weights for each account and asset group."
      resolution={resolution} title="목표비중" titleEn="Target weights" />;
  }

  const scopeContext = await getReadOnlyTenantPortfolioAnalysisScopeContext({ account: params.account, scope: params.scope, tenantContext: resolution.tenantContext });
  if (scopeContext.state !== "ready" || scopeContext.resolution.state !== "resolved") {
    return <PortfolioAnalysisScopeBoundary basePath="/portfolio/targets" context={scopeContext} title="목표비중" titleEn="Target weights" />;
  }
  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  const selectedScope = scopeContext.resolution.scope;
  const model = await getReadOnlyTenantPortfolioTargetPolicyModel({ scope: selectedScope, serviceDate, tenantContext: resolution.tenantContext });
  return <PortfolioTargetPolicyView selectedScope={selectedScope} scopes={scopeContext.catalog.scopes} serviceDate={serviceDate} rows={model.rows}
    universeHash={model.currentUniverseHash} isReady={model.status === "ready"} policyStatus={model.policyValidation.status} approvalRevision={model.approvedPolicy.policy?.approvalRevision ?? null} from={params.from} amount={params.amount} />;
}
