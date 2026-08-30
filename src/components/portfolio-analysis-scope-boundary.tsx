import { SecondaryPageHeader } from "@/components/secondary-page-header";
import Link from "next/link";

import type { TenantPortfolioAnalysisScopeContextResult } from "@/db/queries/portfolio-analysis-scopes";

export function PortfolioAnalysisScopeBoundary({
  basePath,
  context,
  title,
}: {
  basePath: string;
  context: TenantPortfolioAnalysisScopeContextResult;
  title: string;
}) {
  return (
    <main className="varda-secondary-page min-h-screen bg-[var(--paper)] px-4 py-10 text-[var(--ink)]">
      <SecondaryPageHeader />
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[var(--line)] bg-[var(--surface)] p-6">
        <p className="text-xs font-semibold text-[var(--muted)]">Varda Labs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-6 rounded-md border border-[var(--warning-soft)] bg-[var(--surface)] p-3 text-sm text-[var(--warning)]">
          {scopeBoundaryMessage(context)}
        </p>
        <Link
          href={basePath}
          className="mt-5 inline-flex rounded-md border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--wash)]"
        >
          전체 범위로 다시 열기
        </Link>
      </section>
    </main>
  );
}

function scopeBoundaryMessage(context: TenantPortfolioAnalysisScopeContextResult) {
  if (context.state === "unavailable") {
    return "계좌와 자산그룹 범위를 현재 확인할 수 없습니다. 포트폴리오 데이터는 읽지 않았습니다.";
  }
  if (context.state === "integrity_error") {
    return "계좌 또는 자산그룹 목록의 무결성 확인에 실패했습니다. 포트폴리오 데이터는 읽지 않았습니다.";
  }
  return "선택한 계좌 또는 자산그룹을 사용할 수 없습니다. 다른 범위로 자동 대체하지 않았습니다.";
}
