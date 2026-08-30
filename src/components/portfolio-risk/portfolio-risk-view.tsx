import Link from "next/link";
import { SecondaryPageHeader } from "@/components/secondary-page-header";

import type { PortfolioAnalysisScope } from "@/lib/portfolio-analysis-scope";
import type { PortfolioRiskReadModel } from "@/lib/portfolio-risk-read-model";

import { PortfolioRiskControls } from "./portfolio-risk-controls";
import { RiskDataHealth } from "./portfolio-risk-data-health";
import { RiskInstrumentTable } from "./portfolio-risk-instrument-table";
import { RiskCorrelationSections } from "./portfolio-risk-matrices";
import {
  RiskAnalysisBasis,
  RiskPortfolioSummary,
  RiskStandaloneSummary,
} from "./portfolio-risk-summary";

export function PortfolioRiskView({
  model,
  scopes,
  selectedScope,
}: {
  model: PortfolioRiskReadModel;
  scopes: readonly PortfolioAnalysisScope[];
  selectedScope: PortfolioAnalysisScope;
}) {
  const portfolio = model.calculation.portfolio;

  return (
    <main
      data-page="portfolio-risk"
      className="varda-secondary-page min-h-screen overflow-x-hidden bg-[var(--paper)] text-[var(--ink)]"
    >
      <SecondaryPageHeader />
      <div className="mx-auto w-full max-w-[1380px] py-4">
        <header className="pb-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">
                Varda Labs
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">
                포트폴리오 위험·분산
              </h1>
              <p className="mt-1 text-sm text-[var(--muted)]">
                저장된 종가와 환율을 사용한 현재 보유 구성의 읽기 전용 분석
              </p>
            </div>
            <nav className="flex flex-wrap gap-2 text-sm font-semibold">
              <NavLink href="/">대시보드</NavLink>
              <NavLink href="/portfolio/structure">자산 배분</NavLink>
            </nav>
          </div>
          <PortfolioRiskControls
            scopes={scopes}
            selectedScope={selectedScope}
            selection={model.selection}
          />
        </header>

        <RiskAnalysisBasis model={model} scopeLabel={selectedScope.label} />
        <RiskPortfolioSummary model={model} />
        <RiskStandaloneSummary model={model} />
        <RiskInstrumentTable model={model} />
        {portfolio ? (
          <RiskCorrelationSections
            instruments={model.calculation.instruments}
            portfolio={portfolio}
          />
        ) : null}
        <RiskDataHealth model={model} />
      </div>
    </main>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md border border-[var(--line)] bg-white px-3 py-2 text-[var(--ink)] hover:bg-[var(--wash)]"
    >
      {children}
    </Link>
  );
}
