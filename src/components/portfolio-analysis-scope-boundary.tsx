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
    <main className="min-h-screen bg-[#f3f4ef] px-4 py-10 text-[#171916]">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-6">
        <p className="text-xs font-semibold text-[#687064]">Varda Labs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-normal">{title}</h1>
        <p className="mt-6 rounded-md border border-[#ead9b5] bg-[#fff9eb] p-3 text-sm text-[#76591f]">
          {scopeBoundaryMessage(context)}
        </p>
        <Link
          href={basePath}
          className="mt-5 inline-flex rounded-md border border-[#cfd6c8] bg-white px-4 py-2 text-sm font-semibold text-[#35423a] hover:bg-[#eef2e8]"
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
