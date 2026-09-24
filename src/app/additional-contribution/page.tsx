import { localizedMetadata } from "@/lib/i18n/server";
import { CurrencyPortfolioSurface } from "@/components/currency-portfolio-surface";
import { hasNativeLedger } from "@/db/queries/native-portfolio-ledger";
import { getTrackedCurrencyEvidence } from "@/db/queries/currency-tracked-portfolio";
import { AdditionalContributionPageView } from "@/components/additional-contribution/additional-contribution-page-view";
import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { getReadOnlyTenantAdditionalContributionPreviewForScope } from "@/db/queries/additional-contribution";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { getContributionMarketContext } from "@/db/queries/contribution-market-context";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "추가 투입 | CAIRN LABS" }, "Contribute | CAIRN LABS");
}

const DEFAULT_AMOUNT_KRW = 3_000_000;
const MAX_AMOUNT_KRW = 100_000_000_000;

type AdditionalContributionPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    amount?: string | string[];
    preview?: string | string[];
    scope?: string | string[];
    currency?: string | string[];
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
        closedMessageEn="Contribution data is read only after sign-in and account ownership are verified."
        description="승인된 목표비중과 현재 평가액을 로그인한 사용자의 계정 범위에서만 읽습니다."
        descriptionEn="Approved targets and current valuations are read only within the signed-in user’s account scope."
        resolution={resolution}
        title="추가 투입" titleEn="Contribution"
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
        title="추가 투입" titleEn="Contribution"
      />
    );
  }

  const selectedScope = scopeContext.resolution.scope;
  if (params.currency === "USD" || await hasNativeLedger(resolution.tenantContext, scopeContext.resolution.scope)) {
    const reporting = params.currency === "USD" ? "USD" : "KRW";
    const evidence = await getTrackedCurrencyEvidence(resolution.tenantContext, selectedScope, reporting);
    return <CurrencyPortfolioSurface surface="contribution" evidence={evidence} scopes={scopeContext.catalog.scopes} selectedScope={selectedScope} contributionPolicy={evidence.contributionPolicy} />;
  }
  const [preview, marketContext] = await Promise.all([
    getReadOnlyTenantAdditionalContributionPreviewForScope({
      cashAmountKrw: amountKrw,
      scope: selectedScope,
      tenantContext: resolution.tenantContext,
    }),
    getContributionMarketContext(new Date(generatedAt)),
  ]);

  return (
    <AdditionalContributionPageView
      amountKrw={amountKrw}
      generatedAt={generatedAt}
      preview={preview}
      marketContext={marketContext}
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
