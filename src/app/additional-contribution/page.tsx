import { AdditionalContributionPageView } from "@/components/additional-contribution/additional-contribution-page-view";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { getReadOnlyTenantAdditionalContributionPreviewForScope } from "@/db/queries/additional-contribution";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";

export const dynamic = "force-dynamic";

const DEFAULT_AMOUNT_KRW = 3_000_000;
const MAX_AMOUNT_KRW = 100_000_000_000;

type AdditionalContributionPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    amount?: string | string[];
    preview?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function AdditionalContributionPage({
  searchParams,
}: AdditionalContributionPageProps) {
  const generatedAt = new Date().toISOString();
  const params = await searchParams;
  const amountKrw = normalizeAmount(params.amount);

  if (
    process.env.NODE_ENV === "development" &&
    firstSearchParam(params.preview) === "design"
  ) {
    const { buildAdditionalContributionDesignPreview } = await import(
      "@/lib/additional-contribution-design-preview"
    );
    const design = buildAdditionalContributionDesignPreview({
      amountKrw,
      scopeInput: params.scope,
    });
    return (
      <AdditionalContributionPageView
        amountKrw={amountKrw}
        enableLivePriceSync={false}
        generatedAt={generatedAt}
        preview={design.preview}
        scopes={design.scopes}
        selectedScope={design.selectedScope}
      />
    );
  }

  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        closedMessage="로그인과 계정 소유권이 확인되기 전에는 추가 투입 계산 데이터를 읽지 않습니다."
        description="승인된 목표비중과 현재 평가액을 로그인한 사용자의 계정 범위에서만 읽습니다."
        resolution={resolution}
        title="추가 투입"
      />
    );
  }

  const scopeContext = await getReadOnlyTenantPortfolioAnalysisScopeContext({
    account: params.account,
    scope: params.scope,
    tenantContext: resolution.tenantContext,
  });
  if (
    scopeContext.state !== "ready" ||
    scopeContext.resolution.state !== "resolved"
  ) {
    return (
      <PortfolioAnalysisScopeBoundary
        basePath="/additional-contribution"
        context={scopeContext}
        title="추가 투입"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  const preview = await getReadOnlyTenantAdditionalContributionPreviewForScope({
    cashAmountKrw: amountKrw,
    scope: selectedScope,
    tenantContext: resolution.tenantContext,
  });

  return (
    <AdditionalContributionPageView
      amountKrw={amountKrw}
      generatedAt={generatedAt}
      preview={preview}
      scopes={scopeContext.catalog.scopes}
      selectedScope={selectedScope}
    />
  );
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeAmount(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === undefined || raw === "") return DEFAULT_AMOUNT_KRW;
  const amount = Number(raw.replaceAll(",", ""));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_AMOUNT_KRW
    ? amount
    : 0;
}
