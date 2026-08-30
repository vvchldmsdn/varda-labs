import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";

import { PortfolioAnalysisScopeBoundary } from "@/components/portfolio-analysis-scope-boundary";
import { PortfolioAnalysisScopeTabs } from "@/components/portfolio-analysis-scope-tabs";
import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import { PortfolioTargetPolicyForm } from "@/components/portfolio-target-policy-form";
import { getReadOnlyTenantPortfolioAnalysisScopeContext } from "@/db/queries/portfolio-analysis-scopes";
import { getReadOnlyTenantPortfolioTargetPolicyModel } from "@/db/queries/portfolio-target-policy";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

type PortfolioTargetsPageProps = {
  searchParams: Promise<{
    account?: string | string[];
    scope?: string | string[];
  }>;
};

export default async function PortfolioTargetsPage({
  searchParams,
}: PortfolioTargetsPageProps) {
  const [params, resolution] = await Promise.all([
    searchParams,
    resolveCurrentTenantContext(),
  ]);
  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        closedMessage="로그인과 계정 소유권이 확인되기 전에는 목표비중을 읽거나 저장하지 않습니다."
        description="계좌와 자산그룹별로 사용자가 직접 정한 목표비중을 관리합니다."
        resolution={resolution}
        title="목표비중"
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
        basePath="/portfolio/targets"
        context={scopeContext}
        title="목표비중"
      />
    );
  }

  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  const selectedScope = scopeContext.resolution.scope;
  const model = await getReadOnlyTenantPortfolioTargetPolicyModel({
    scope: selectedScope,
    serviceDate,
    tenantContext: resolution.tenantContext,
  });

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-4 text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="mx-auto w-full max-w-[1300px] space-y-4">
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                목표비중
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)]">
                선택한 계좌 또는 자산그룹 안에서 새 투자금을 배분할 기준을 직접 정합니다.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/portfolio/structure">포트 구조</NavLink>
              <NavLink href="/additional-contribution">추가 투입</NavLink>
              <NavLink href="/portfolio/groups">자산 그룹</NavLink>
              <NavLink href="/portfolio/holdings/new">보유종목 추가</NavLink>
            </nav>
          </div>

          <div className="mt-5">
            <PortfolioAnalysisScopeTabs
              basePath="/portfolio/targets"
              scopes={scopeContext.catalog.scopes}
              selectedScopeKey={selectedScope.key}
            />
          </div>

          <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCell label="선택 범위" value={selectedScope.label} />
            <SummaryCell label="기준일" value={serviceDate.replaceAll("-", ".")} />
            <SummaryCell
              label="보유 종목"
              value={`${model.rows.length}개`}
              detail={`${model.rows.filter((row) => row.buyability === "buyable").length}개 목표 설정 가능`}
            />
            <SummaryCell
              label="저장 상태"
              value={
                model.policyValidation.status === "available"
                  ? `승인본 ${model.approvedPolicy.policy?.approvalRevision ?? "-"}`
                  : model.policyValidation.status === "conflict" ||
                      model.policyValidation.status === "integrity_error"
                    ? "검증 필요"
                    : "첫 설정"
              }
              detail={
                model.exactPolicyUniverse
                  ? "현재 구성과 일치"
                  : "현재 비중을 편집 시작값으로 표시"
              }
            />
          </dl>
        </section>

        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{selectedScope.label} 목표</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                저장하면 같은 범위의 이전 승인본은 수정되지 않고 종료 이력으로 남습니다.
              </p>
            </div>
            <span className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-xs font-semibold text-[var(--muted)]">
              계좌·종목별 목적지 보존
            </span>
          </div>

          {model.status === "ready" ? (
            <PortfolioTargetPolicyForm
              key={`${selectedScope.key}:${model.currentUniverseHash}`}
              rows={model.rows}
              scopeKey={selectedScope.key}
              universeHash={model.currentUniverseHash!}
            />
          ) : (
            <div className="mt-5 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
              현재 범위의 보유종목 구성을 목표비중으로 만들 수 없습니다. 보유종목과 계좌 연결을 먼저 확인해 주세요.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function SummaryCell({
  detail,
  label,
  value,
}: {
  detail?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-4">
      <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-lg font-semibold">{value}</dd>
      {detail ? <p className="mt-1 text-xs text-[var(--muted)]">{detail}</p> : null}
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)] hover:bg-[var(--wash)]"
      href={href}
    >
      {children}
    </Link>
  );
}
