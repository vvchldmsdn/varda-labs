import { SimulationText } from "@/components/simulation/simulation-text";
import { simulationEnglish } from "@/components/simulation/simulation-copy";
import { LocalizedElement } from "@/components/i18n/localized-element";
import type { ReactNode } from "react";
import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { InvestmentLabDialog as SimulationDialog } from "@/components/investment-lab/investment-lab-dialog";
import { SimulationWorkspace } from "./simulation-workspace";
import { SimulationLink as Link, SimulationScopeTabs, SimulationDateControl, SimulationModelSelector } from "./simulation-query-controls";
import type { SimulationPageControls } from "@/lib/simulation-page-controls";
import type { PortfolioAnalysisScope, PortfolioAnalysisScopeKey } from "@/lib/portfolio-analysis-scope";
import { SIMULATION_RESEARCH_HORIZON_POLICY } from "@/lib/simulation-research-horizon";
import { buildSimulationHref } from "@/lib/simulation-navigation";
import styles from "./simulation-workspace.module.css";
import type { SimulationPathModel } from "@/lib/simulation-model-selection";
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
      <div className="varda-content varda-presentation-content varda-stage-content flex flex-col">
        <header className={styles.stageHeader}>
          <div className={styles.stageHeading}><h1 className="varda-page-title"><SimulationText ko={"시뮬레이션"} /></h1>
            <SimulationDialog
              label="계산 조건" labelEn={simulationEnglish("계산 조건")}
              title="시뮬레이션 계산 조건" titleEn={simulationEnglish("시뮬레이션 계산 조건")}
              icon="calendar"
              compactLabel
            >
              <SimulationDateControl />
              <div className="mt-5 space-y-3 text-sm leading-7 text-[var(--muted)]">
                {pathModel === "economic" ? <>
                  <p><SimulationText ko="가격 학습은 저장 이력의 최신 공통 기준일까지, 출발 경제 상태는 현재 서비스 기준일까지의 자료를 사용합니다. 두 날짜는 다를 수 있으며 ‘모형·데이터’에서 각각 확인할 수 있습니다." en="Price fitting uses the latest common stored-history cutoff; the starting economic state uses the current service cutoff. These dates can differ and are shown separately in Model & data." /></p>
                  <p><SimulationText ko="기준일을 직접 선택하면 가격 학습과 경제 상태에 같은 날짜를 적용합니다. 경제지표는 그 날짜보다 먼저 공표된 관측만 사용하며 최신성 한도는 7일입니다. 필요한 값이나 이력이 없으면 다른 날짜나 값으로 대체하지 않습니다." en="An explicit cutoff applies to both price fitting and the economic state. Economic observations must have been released before that date and be no more than seven days old. Missing inputs are not replaced with another date or value." /></p>
                  <p><SimulationText ko="최대 90개 공동 수익률 구간 중 경제지표와 함께 맞는 최소 45개로 학습합니다. 선택한 63·126단계는 수익률 관측 단계이며, 현재 종목 구성을 사용하는 연구입니다. 실제 과거 매매 기록을 재현하지 않습니다." en="Fit on at least 45 factor-aligned intervals within up to 90 common returns. The selected 63 or 126 steps are return-observation steps. This research uses today's holdings, without reconstructing actual past trades." /></p>
                </> : pathModel === "bootstrap" ? <>
                <p>
                  <SimulationText ko={"내 포트폴리오는 저장 이력의 최신 공통 기준일을 사용합니다. 기준일을 지정하면 그 날짜를 정확히 적용하며, 누락된 이력을 임의로 채우지 않습니다."} />{" "}</p>
                <p>
                  <SimulationText ko={"현재 구성과 최근 90개 공동 수익률로 연구 경로를 계산합니다. 현재 보유 수량의 과거 기록을 재현하는 백테스트가 아닙니다."} />{" "}</p>
                <p>
                  <SimulationText ko={"기간은 수익률 관측 단계입니다. 시장 국면 모델은 별도로 63단계를 사용합니다. 고정 종목 연구는 직접 지정한 기준일로만 실행합니다."} />{" "}</p>
                </> : <p><SimulationText ko="경제지표 또는 과거 수익률 모형을 선택한 뒤 계산 조건을 확인해 주세요." en="Choose Economic paths or Historical paths before reviewing model settings." /></p>}
              </div>
            </SimulationDialog>
          </div>
          <SimulationScopeTabs scopes={scopeCatalog} selectedScopeKey={selectedScopeKey} />
        </header>
        {model.endServiceDateSelection.status === "invalid" ? (
          <p
            data-invalid-end-query
            role="alert"
            className="border-y border-[var(--line)] py-3 text-sm text-[var(--warning)]"
          >
            <SimulationText ko={"기준일은 하나의 YYYY-MM-DD 값으로 입력해야 합니다. 계산 조건에서 날짜를 확인해 주세요."} />{" "}</p>
        ) : null}
        {model.researchHorizonSelection.status === "invalid" ? (
          <p
            data-invalid-horizon-query
            role="alert"
            className="border-y border-[var(--line)] py-3 text-sm text-[var(--warning)]"
          >
            <SimulationText ko={"연구 기간은 63 또는 126단계만 가능합니다. 잘못된 값을 기본 기간으로 대체하지 않았습니다."} />{" "}</p>
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
          <SimulationText ko={"현재 구성 기준 연구 · 수수료·세금·현금수익률 미포함 · 결과는 수익 보장, 추천 또는 주문 근거가 아닙니다."} />{" "}</footer>
      </div>
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
      <span className="text-[11px] text-[var(--faint)]"><SimulationText ko={"연구 기간"} /></span>
      <nav className="flex gap-1 rounded-md bg-[var(--wash)] p-1">
        {SIMULATION_RESEARCH_HORIZON_POLICY.allowedHorizons.map((horizon) => {
          const selected = horizon === selectedHorizon;
          return (
            <Link
              aria-current={selected ? "page" : undefined}
              className={
                selected
                  ? "rounded bg-[var(--paper)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] shadow-sm"
                  : "rounded px-3 py-1.5 text-xs text-[var(--faint)] hover:text-[var(--ink)]"
              }
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
