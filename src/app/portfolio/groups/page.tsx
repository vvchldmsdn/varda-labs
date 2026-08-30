import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";

import { PortfolioReadAccessBoundary } from "@/components/portfolio-read-access-boundary";
import {
  PortfolioGroupCreateForm,
  PortfolioGroupEditor,
} from "@/components/portfolio-group-management";
import { getReadOnlyTenantPortfolioGroupManagementModel } from "@/db/queries/portfolio-group-management";
import { resolveCurrentTenantContext } from "@/lib/auth/current-tenant-context";
import { resolveSnapshotCycle } from "@/lib/snapshots/market-calendar";

export const dynamic = "force-dynamic";

export default async function PortfolioGroupsPage() {
  const resolution = await resolveCurrentTenantContext();
  if (!resolution.ok) {
    return (
      <PortfolioReadAccessBoundary
        closedMessage="로그인과 사용자 소유권이 확인되기 전에는 자산 그룹을 조회하거나 변경하지 않습니다."
        description="여러 계좌 또는 일부 종목을 하나의 분석 범위로 묶습니다."
        resolution={resolution}
        title="자산 그룹 관리"
      />
    );
  }

  const serviceDate = resolveSnapshotCycle(new Date()).snapshotDate;
  const model = await getReadOnlyTenantPortfolioGroupManagementModel({
    serviceDate,
    tenantContext: resolution.tenantContext,
  });

  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-4 text-[var(--ink)]">
      <SecondaryPageHeader />
      <div className="mx-auto w-full max-w-[1200px] space-y-4">
        <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                자산 그룹 관리
              </h1>
              <p className="mt-2 text-sm text-[var(--muted)]">
                실제 계좌와 별개로, 함께 분석할 계좌와 종목을 묶습니다.
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">홈</NavLink>
              <NavLink href="/portfolio/holdings">보유종목</NavLink>
              <NavLink href="/portfolio/holdings/new">보유종목 추가</NavLink>
            </nav>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <SummaryCell
              label="기준일"
              value={serviceDate.replaceAll("-", ".")}
            />
            <SummaryCell
              label="활성 그룹"
              value={model.state === "ready" ? `${model.groups.length}개` : "-"}
            />
            <SummaryCell
              label="선택 가능"
              value={
                model.state === "ready"
                  ? `계좌 ${model.accounts.length} · 종목 ${model.assets.length}`
                  : "-"
              }
            />
          </dl>
        </section>

        {model.state !== "ready" ? (
          <section className="rounded-lg border border-[var(--warning-soft)] bg-[var(--surface)] p-4 text-sm text-[var(--warning)]">
            자산 그룹 정보를 불러오지 못했습니다. 데이터 연결 상태를 확인해 주세요.
          </section>
        ) : (
          <>
            <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
              <h2 className="text-lg font-semibold">새 그룹</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                빈 그룹도 만들 수 있으며 구성은 언제든 바꿀 수 있습니다.
              </p>
              <div className="mt-4">
                <PortfolioGroupCreateForm
                  accounts={model.accounts}
                  assets={model.assets}
                />
              </div>
            </section>

            <section className="space-y-3">
              <div className="px-1">
                <h2 className="text-lg font-semibold">기존 그룹</h2>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  변경일 이후의 홈, 오늘 변동, 추가 투입, 위험, 투자랩과 시뮬레이션에 같은 범위가 적용됩니다.
                </p>
              </div>
              {model.groups.length === 0 ? (
                <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5 text-sm text-[var(--muted)]">
                  아직 만든 자산 그룹이 없습니다.
                </div>
              ) : (
                model.groups.map((group) => (
                  <PortfolioGroupEditor
                    accounts={model.accounts}
                    assets={model.assets}
                    group={group}
                    key={`${group.id}:${group.updatedAt}`}
                  />
                ))
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[var(--line)] bg-white p-4">
      <dt className="text-xs font-semibold text-[var(--muted)]">{label}</dt>
      <dd className="mt-2 text-lg font-semibold">{value}</dd>
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
