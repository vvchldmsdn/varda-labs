import { SimulationText } from "@/components/simulation/simulation-text";
import { simulationEnglish } from "@/components/simulation/simulation-copy";
import { LocalizedElement } from "@/components/i18n/localized-element";
import type { ReactNode } from "react";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { InvestmentLabDialog as SimulationDialog } from "@/components/investment-lab/investment-lab-dialog";
import { SimulationWorkspace } from "./simulation-workspace";
import { SimulationLink as Link, SimulationScopeTabs, SimulationDateControl, SimulationModelSelector, SimulationNavigationBoundary } from "./simulation-query-controls";
import type { SimulationPageControls } from "@/lib/simulation-page-controls";
import type { PortfolioAnalysisScope, PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import { SIMULATION_RESEARCH_HORIZON_POLICY } from "@/lib/simulation-research-horizon";
import { buildSimulationHref } from "@/lib/simulation-navigation";
import styles from "./simulation-workspace.module.css";
import type { SimulationPathModel } from "@/lib/simulation-model-selection";
import { PageTitle as CairnPageTitle, Status as CairnStatus } from "@/components/cairn-ui";

export function SimulationInputReadinessView({model, pathModel, ownerResearchExecution, researchUniverse, selectedScopeKey, scopeCatalog}: {
 model: SimulationPageControls; ownerResearchExecution?: ReactNode; researchUniverse: string | null;
 pathModel: SimulationPathModel | null;
 selectedScopeKey: PortfolioAnalysisScopeKey; scopeCatalog: readonly PortfolioAnalysisScope[];
}) {
 const selectedKodexWeightPct = model.fixedMixSelection.kodexWeightPct;
 const selectedResearchHorizon = model.researchHorizonSelection.horizon;
 const explicitEndServiceDate = model.endServiceDateSelection.status === "valid" && model.endServiceDateSelection.source === "query" ? model.requestedEndServiceDate : null;
  return (
    <main
      data-page="simulation-input-readiness"
      data-runtime-trust-status={model.runtimeTrustStatus}
      data-end-query-status={model.endServiceDateSelection.status}
      className="varda-page varda-presentation-page varda-stage-page bg-[var(--paper)] text-[var(--ink)]"
    >
      <PortfolioPrimaryNavigation
        activePath="/simulation"
        selectedScopeKey={selectedScopeKey}
        generatedAt={model.generatedAt}
      />
      <SimulationNavigationBoundary className="varda-content varda-presentation-content varda-stage-content flex flex-col">
        <header className={styles.stageHeader}>
          <div className={styles.stageHeading}><CairnPageTitle className="varda-page-title"><SimulationText ko={"시뮬레이션"} /></CairnPageTitle>
            <SimulationDialog
              label="계산 조건" labelEn={simulationEnglish("계산 조건")}
              title="시뮬레이션 계산 조건" titleEn={simulationEnglish("시뮬레이션 계산 조건")}
              icon="calendar"
              compactLabel
            >
              <SimulationDateControl />
              {pathModel ? <>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]"><SimulationText ko="빈 날짜는 최신 자료 기준이에요. 선택한 날짜는 그대로 적용하며, 없는 자료는 채우지 않습니다." en="Leave the date empty for the latest available inputs. A selected date is used exactly; missing inputs are never filled in." /></p>
                <details className="cairn-details mt-5">
                  <summary><SimulationText ko="기간과 계산 방식" en="Period and method" /></summary>
                  <dl className="space-y-5 pb-2 text-sm leading-6 text-[var(--muted)]">
                    {pathModel === "economic" ? <>
                      <div><dt className="mb-1 font-medium text-[var(--ink)]"><SimulationText ko="기준일" en="Reference dates" /></dt><dd><SimulationText ko="가격 학습은 최신 공통 종가까지, 경제지표는 현재 서비스 기준일까지 사용합니다. 두 날짜는 다를 수 있어요. 날짜를 선택하면 둘 다 같은 기준일을 적용합니다." en="Prices use the latest common close; economic inputs use the current service cutoff. These dates can differ. Selecting a date applies the same cutoff to both." /></dd></div>
                      <div><dt className="mb-1 font-medium text-[var(--ink)]"><SimulationText ko="사용한 자료" en="Inputs" /></dt><dd><SimulationText ko="최대 90개 공동 수익률 중 경제지표와 맞는 최소 45개로 학습합니다. 경제지표는 기준일 전에 공표된 값만 사용하며, 최신성 한도는 7일입니다." en="Fit on at least 45 factor-aligned intervals from up to 90 common returns. Economic inputs must be released before the cutoff and no more than seven days old." /></dd></div>
                    </> : <div><dt className="mb-1 font-medium text-[var(--ink)]"><SimulationText ko="사용한 자료" en="Inputs" /></dt><dd><SimulationText ko="적용한 기준일까지의 최근 90개 공동 수익률을 사용합니다." en="Use the latest 90 joint returns through the applied cutoff." /></dd></div>}
                    <div><dt className="mb-1 font-medium text-[var(--ink)]"><SimulationText ko="계산 기간과 범위" en="Period and scope" /></dt><dd><SimulationText ko="63·126단계는 달력 날짜가 아닌 수익률 관측 수입니다. 현재 구성의 가상 연구이며, 과거 보유·매매 기록을 재현하지 않습니다." en="63 or 126 steps count return observations, not calendar days. This is hypothetical research on current holdings, not a reconstruction of past holdings or trades." /></dd>
                      {pathModel === "bootstrap" && <dd className="mt-2"><SimulationText ko="시장 국면 모델은 별도로 63단계를 사용합니다. 고정 종목 연구는 기준일을 직접 지정해야 합니다." en="The market-regime model uses a separate 63-step period. Fixed-holding research requires an explicitly selected cutoff." /></dd>}
                    </div>
                  </dl>
                </details>
              </> : <p className="mt-3 text-sm leading-6 text-[var(--muted)]"><SimulationText ko="경제지표 또는 과거 수익률 모형을 선택한 뒤 계산 조건을 확인해 주세요." en="Choose Economic paths or Historical paths before reviewing model settings." /></p>}
            </SimulationDialog>
          </div>
          <SimulationScopeTabs scopes={scopeCatalog} selectedScopeKey={selectedScopeKey} />
        </header>
        <p className={styles.intro}><SimulationText ko="현재 구성을 유지하면 어떤 경로가 나올까요?" en="Explore possible paths with your current holdings." /></p>
        {model.endServiceDateSelection.status === "invalid" ? (
          <CairnStatus as="p" tone="danger"
            data-invalid-end-query
            role="alert"
            className="border-y border-[var(--line)] py-3 text-sm text-[var(--warning)]"
          >
            <SimulationText ko={"기준일은 하나의 YYYY-MM-DD 값으로 입력해야 합니다. 계산 조건에서 날짜를 확인해 주세요."} />{" "}</CairnStatus>
        ) : null}
        {model.researchHorizonSelection.status === "invalid" ? (
          <CairnStatus as="p" tone="danger"
            data-invalid-horizon-query
            role="alert"
            className="border-y border-[var(--line)] py-3 text-sm text-[var(--warning)]"
          >
            <SimulationText ko={"연구 기간은 63 또는 126단계만 가능합니다. 잘못된 값을 기본 기간으로 대체하지 않았습니다."} />{" "}</CairnStatus>
        ) : null}
        <div className={styles.workspaceSlot}>
          <SimulationWorkspace
          tools={
            <><SimulationModelSelector /><ResearchHorizonSelector
              scopeKey={selectedScopeKey}
              endServiceDate={explicitEndServiceDate}
              kodexWeightPct={selectedKodexWeightPct}
              researchUniverse={researchUniverse}
              selectedHorizon={selectedResearchHorizon}
            /></>
          }
          paths={
            <div className={styles.currentResult} id="simulation-current-result">{ownerResearchExecution}</div>
          }
          />
        </div>
        <footer className={styles.stageFootnote}>
          <SimulationText ko="현재 구성의 가상 경로 · 수수료·세금·현금수익률 미포함 · 미래 수익을 보장하지 않습니다." en="Hypothetical paths for current holdings · Excludes fees, taxes and cash returns · Future returns are not guaranteed." /></footer>
      </SimulationNavigationBoundary>
    </main>
  );
}

function ResearchHorizonSelector({
  scopeKey,
  endServiceDate,
  kodexWeightPct,
  researchUniverse,
  selectedHorizon,
}: {
  scopeKey: PortfolioAnalysisScopeKey;
  endServiceDate: string | null;
  kodexWeightPct: number | null;
  researchUniverse: string | null;
  selectedHorizon: 63 | 126 | null;
}) {
  return (
    <LocalizedElement
      aria-label="연구 기간 선택"
      className="flex items-center gap-3"
      data-simulation-research-horizon={selectedHorizon ?? "invalid"} as="section" en={{"aria-label": simulationEnglish("연구 기간 선택")}}
    >
      <nav className={`cairn-tabs ${styles.textTabs}`}>
        {SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons.map((horizon) => {
          const selected = horizon === selectedHorizon;
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={styles.textTab}
              href={buildSimulationHref({
                scope: scopeKey,
                endServiceDate,
                kodexWeightPct,
                researchHorizon: horizon,
                researchUniverse,
              })}
              key={horizon}
              scroll={false}
            >
              {horizon}<SimulationText ko={"단계"} />{" "}</Link>
          );
        })}
      </nav>
    </LocalizedElement>
  );
}
