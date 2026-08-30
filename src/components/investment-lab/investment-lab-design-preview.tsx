import { PortfolioPrimaryNavigation } from "@/components/portfolio-primary-navigation";
import { buildInvestmentLabDesignPreview } from "@/lib/investment-lab-design-preview";
import { InvestmentLabWorkspace } from "./investment-lab-workspace";
import { InvestmentLabScopeTabs } from "./investment-lab-scope-tabs";
import { InvestmentLabPeriodSelector } from "./investment-lab-period-selector";
import { InvestmentLabTimeMachine } from "./investment-lab-time-machine";
import { InvestmentLabFixedMix } from "./investment-lab-fixed-mix";
import { InvestmentLabEtfXray } from "./investment-lab-etf-xray";
import { InvestmentLabDisclosure } from "./investment-lab-disclosure";
import {
  labKrw,
  labPercent,
  labScenarioLabel,
} from "./investment-lab-chart-presentation";

export function InvestmentLabDesignPreview({
  query,
}: {
  query: Parameters<typeof buildInvestmentLabDesignPreview>[0];
}) {
  const { dashboard, chart, summaries, period, selection, model, etfXray } =
    buildInvestmentLabDesignPreview(query);
  return (
    <main
      className="min-h-screen overflow-x-hidden bg-[#f8f9f6] text-[#171a16]"
      data-lab-design-preview
    >
      <PortfolioPrimaryNavigation
        activePath="/investment-lab"
        generatedAt={dashboard.generatedAt}
        selectedScopeKey={dashboard.selectedScope.key}
      />
      <div className="mx-auto w-full max-w-[1540px] px-5 pb-16 pt-7 sm:px-8 lg:px-10">
        <header>
          <div className="flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#777d75]">
            <p>PORTFOLIO / LAB</p>
            <p>디자인 미리보기 · 예시 데이터</p>
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <h1 className="text-2xl font-medium">투자 랩</h1>
            <InvestmentLabScopeTabs
              scopes={dashboard.analysisScopes}
              selectedScopeKey={dashboard.selectedScope.key}
            />
          </div>
        </header>
        <div className="mt-8">
          <InvestmentLabWorkspace
            tools={
              <InvestmentLabPeriodSelector
                period={period}
                query={query}
                scopeKey={dashboard.selectedScope.key}
              />
            }
            comparison={
              <>
                <InvestmentLabTimeMachine
                  chart={chart}
                  scenarioSummaries={summaries}
                  unavailableScenarios={[
                    {
                      id: "approved_target_weight_monthly",
                      reason: "일부 계좌에 목표 비중이 설정되어 있지 않습니다.",
                      resolution:
                        "목표 비중을 설정하면 해당 효력일 이후의 비교를 계산할 수 있습니다.",
                    },
                    {
                      id: "preperiod_min_volatility",
                      reason: "시작일 이전의 공통 가격 이력이 부족합니다.",
                      resolution:
                        "데이터 준비에서 누락된 종목과 날짜를 확인하거나 비교 시작일을 조정할 수 있습니다.",
                    },
                  ]}
                />
                <InvestmentLabDisclosure
                  title="모든 시나리오 비교"
                  detail={`${summaries.length}개 경로`}
                >
                  <div className="overflow-x-auto pb-5">
                    <table className="w-full min-w-[570px] text-left text-sm">
                      <thead className="text-xs text-[#788276]">
                        <tr>
                          <th className="py-4 font-normal">시나리오</th>
                          <th className="font-normal">종료 평가액</th>
                          <th className="font-normal">실제 대비</th>
                          <th className="font-normal">추정수익률</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaries.map((row) => (
                          <tr
                            className="border-t border-[#e0e5dd] tabular-nums"
                            key={row.id}
                          >
                            <th className="py-4 font-medium">
                              {labScenarioLabel(row.id)}
                            </th>
                            <td>{labKrw(row.endValueKrw)}</td>
                            <td>{labKrw(row.endDifferenceKrw, true)}</td>
                            <td>{labPercent(row.returnEstimate, true)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </InvestmentLabDisclosure>
              </>
            }
            experiments={
              <InvestmentLabFixedMix
                comparison={model.fixedMixComparison}
                model={model.fixedMixScenario}
                period={period}
                scopeKey={dashboard.selectedScope.key}
                selection={selection}
              />
            }
            composition={<InvestmentLabEtfXray model={etfXray} />}
          />
        </div>
      </div>
    </main>
  );
}
