import type { SimulationRegimeScenarioResult } from "@/lib/simulation-regime-bootstrap";

import {
  ResearchFanChart,
  type ResearchFanChartValueDomain,
} from "./research-fan-chart";
import { SimulationTerminalRiskMetrics } from "./simulation-terminal-risk-metrics";

export type ReadyRegimeScenario = Extract<
  SimulationRegimeScenarioResult,
  { status: "ready" }
>;

export function RegimeScenarioCard({
  scenario,
  valueDomain,
  group,
  eyebrow,
  selected = false,
}: {
  scenario: ReadyRegimeScenario;
  valueDomain: ResearchFanChartValueDomain;
  group: "reference" | "fixed_mix_comparison" | "custom";
  eyebrow: string;
  selected?: boolean;
}) {
  const fixedMixKey = `${scenario.weightsBps[0] / 100}-${scenario.weightsBps[1] / 100}`;

  return (
    <article
      className="overflow-hidden rounded-lg border border-[#d7ddcf] bg-[#fbfcf7]"
      data-regime-scenario={scenario.id}
      data-regime-scenario-group={group}
      data-regime-scenario-selected={selected ? "true" : "false"}
      data-regime-scenario-status="ready"
      data-regime-scenario-kodex-weight-bps={scenario.weightsBps[0]}
      data-regime-scenario-voo-weight-bps={scenario.weightsBps[1]}
      data-regime-fixed-mix-scenario={
        group === "fixed_mix_comparison" ? fixedMixKey : undefined
      }
      data-regime-fixed-mix-scenario-status={
        group === "fixed_mix_comparison" ? "ready" : undefined
      }
    >
      <header className="flex items-start justify-between gap-3 border-b border-[#e1e5da] px-4 py-4">
        <div>
          <p className="text-xs font-semibold text-[#687064]">{eyebrow}</p>
          <h3 className="mt-1 text-lg font-semibold">{scenario.name}</h3>
          <p className="mt-1 text-xs text-[#687064]">
            069500 {formatBps(scenario.weightsBps[0])} · VOO{" "}
            {formatBps(scenario.weightsBps[1])} · 최초 배분 후 리밸런싱 없음
          </p>
        </div>
        {selected ? (
          <span className="shrink-0 rounded-md bg-[#e5f1e6] px-2.5 py-1 text-xs font-semibold text-[#226039]">
            현재 입력
          </span>
        ) : null}
      </header>
      <SimulationTerminalRiskMetrics compact terminal={scenario.terminal} />
      <ResearchFanChart execution={scenario} valueDomain={valueDomain} />
    </article>
  );
}

function formatBps(value: number) {
  return `${(value / 100).toFixed(0)}%`;
}
