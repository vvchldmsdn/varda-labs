import { localizedMetadata } from "@/lib/i18n/server";
import { ManagementText } from "@/components/i18n/management-text";
import { T } from "@/components/i18n/localized-text";
import { HoldingsManagementList } from "@/components/holdings-management-list";
import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";

import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import {
  getReadOnlyTenantPortfolioAnalysisScopeContext,
  type TenantPortfolioAnalysisScopeContextResult,
} from "@/db/queries/portfolio-analysis-scopes";
import {
  getReadOnlyTenantHoldingAnalysisDataReadiness,
} from "@/db/queries/holding-analysis-data-readiness";
import {
  getReadOnlyTenantHoldings,
  type TenantHoldingQueryResult,
} from "@/db/queries/tenant-holdings";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import type { SessionResolverResult } from "@/lib/session-resolver-contract";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  return localizedMetadata({ title: "보유 종목 | VARDA LABS" }, "Holdings | VARDA LABS");
}

type TenantHoldingsPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function TenantHoldingsPage({
  searchParams,
}: TenantHoldingsPageProps) {
  const [params, tenantResolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  const serviceDate = resolveSnapshotCycle().snapshotDate;
  const scopeContext = tenantResolution.ok
    ? await getReadOnlyTenantPortfolioAnalysisScopeContext({
        account: params.account,
        scope: params.scope,
        tenantContext: tenantResolution.tenantContext,
      })
    : null;
  const selectedScope =
    scopeContext?.state === "ready" &&
    scopeContext.resolution.state === "resolved"
      ? scopeContext.resolution.scope
      : null;
  const result = tenantResolution.ok && selectedScope
    ? await getReadOnlyTenantHoldings({
        serviceDate,
        scope: selectedScope,
        tenantContext: tenantResolution.tenantContext,
      })
    : null;
  const visibleHoldings =
    result?.state === "ready" || result?.state === "partial"
      ? result.holdings
      : [];
  const activeHoldings = visibleHoldings.filter(
    (holding) => holding.archivedAt === null,
  );
  const analysisDataResult =
    tenantResolution.ok && activeHoldings.length > 0
      ? await getReadOnlyTenantHoldingAnalysisDataReadiness({
          tenantContext: tenantResolution.tenantContext,
          serviceDate,
          holdings: activeHoldings.map((holding) => ({
            holdingId: holding.holdingId,
            accountCode: holding.accountCode,
            name: holding.name,
            ticker: holding.ticker,
            assetType: holding.assetType,
            market: holding.market,
            currency: holding.currency,
          })),
        })
      : null;
  const analysisDataByHolding = new Map(
    analysisDataResult?.state === "ready"
      ? analysisDataResult.entries.map((entry) => [entry.holdingId, entry])
      : [],
  );

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-8 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-5xl">
        <header className="border-b border-[var(--line)] pb-6">
          <Link href="/portfolio/manage" className="text-sm text-[var(--muted)]"><T ko="← 관리" en="← Manage" /></Link>
          <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0"><h1 className="text-2xl font-medium"><T ko="보유 종목" en="Your holdings" /></h1><p className="mt-2 text-sm leading-6 text-[var(--muted)]"><T ko="수량과 매입가를 확인하고 수정하세요. 매입가는 나중에 입력해도 됩니다." en="Review quantities and average costs. You can add missing purchase costs later." /></p></div>
            <Link href="/portfolio/holdings/new" className="inline-flex min-h-11 items-center rounded-full bg-[var(--ink)] px-5 text-sm font-medium text-[var(--paper)]"><T ko="종목 추가" en="Add holding" /></Link>
          </div>
          <details className="mt-4 text-sm"><summary className="w-fit cursor-pointer py-2 text-[var(--muted)]"><T ko="계좌·관련 기록" en="Accounts & related records" /></summary><nav className="mt-2 flex flex-wrap gap-x-5 gap-y-3 text-sm">
            <Link href="/portfolio/accounts"><T ko="계좌 관리" en="Accounts" /></Link>
            <Link href="/portfolio/groups"><T ko="분석 범위" en="Analysis scopes" /></Link>
            <Link href="/portfolio/position-snapshots?account=all"><T ko="종목별 기록" en="Holding records" /></Link>
            <Link href="/portfolio/portfolio-snapshots?account=all"><T ko="포트폴리오 기록" en="Portfolio records" /></Link>
          </nav></details>
        </header>
        <div className="my-6 min-w-0">
          {scopeContext?.state === "ready" ? <PortfolioAnalysisScopeTabs basePath="/portfolio/holdings" scopes={scopeContext.catalog.scopes} selectedScopeKey={selectedScope?.key ?? null} /> : null}
          <p className="mt-4 text-sm font-medium"><ManagementText>{selectedScope?.label ?? "범위를 확인할 수 없습니다"}</ManagementText></p>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">{holdingReadEvidence(result, tenantResolution, scopeContext)}</p>
        </div>
        {result?.state === "ready" || result?.state === "partial" ? <>
          {result.state === "partial" ? <p className="mb-4 text-sm leading-6 text-[var(--warning)]"><T ko="일부 종목 정보가 불완전해 목록에서 제외했습니다. 이 목록으로 전체 평가액을 합산하지 않습니다." en="Some incomplete holdings are excluded. This list is not a complete portfolio valuation." /></p> : null}
          <HoldingsManagementList holdings={visibleHoldings} analysisDataByHolding={analysisDataByHolding} />
        </> : <p className="border-t border-[var(--line)] py-6 text-sm leading-6 text-[var(--warning)]"><T ko="보유종목을 불러오지 못했습니다. 로그인 상태와 선택한 계좌를 확인한 뒤 다시 시도해 주세요." en="Holdings could not be loaded. Check your sign-in and selected account, then try again." /></p>}
      </section>
    </main>
  );
}

function holdingReadEvidence(
  result: TenantHoldingQueryResult | null,
  tenantResolution: SessionResolverResult,
  scopeContext: TenantPortfolioAnalysisScopeContextResult | null,
) {
  if (!tenantResolution.ok) return <T ko="로그인 상태를 확인해 주세요." en="Check your sign-in to view holdings." />;
  if (!scopeContext || scopeContext.state !== "ready" || scopeContext.resolution.state === "blocked") return <T ko="선택한 계좌와 분석 범위를 확인해 주세요." en="Check the selected account and analysis scope." />;
  if (!result || result.state === "unavailable" || result.state === "integrity_error") return <T ko="보유종목 정보를 확인하지 못했습니다." en="Holding information is unavailable." />;
  const activeCount = result.holdings.filter(holding => holding.archivedAt === null).length;
  const archivedCount = result.holdings.length - activeCount;
  return <T ko={`보유 ${activeCount}종목 · 종료 ${archivedCount}종목${result.state === "partial" ? ` · 정보 확인 필요 ${result.excludedHoldingCount}종목` : ""}`} en={`${activeCount} active · ${archivedCount} closed${result.state === "partial" ? ` · ${result.excludedHoldingCount} need review` : ""}`} />;
}
