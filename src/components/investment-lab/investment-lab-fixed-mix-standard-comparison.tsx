import { InvestmentLabFixedMixComparisonChart } from "./investment-lab-fixed-mix-comparison-chart";
import {
  formatInvestmentLabKrw,
  formatInvestmentLabSignedKrw,
  formatInvestmentLabSignedPercent,
  investmentLabFixedMixBlockerLabel,
} from "./investment-lab-fixed-mix-presentation";
import type { InvestmentLabFixedMixComparison } from "@/lib/investment-lab-fixed-mix-comparison";

export function InvestmentLabFixedMixStandardComparison({
  model,
  selectedKodexWeightPct,
}: {
  model: InvestmentLabFixedMixComparison | null;
  selectedKodexWeightPct: number | null;
}) {
  if (!model || model.readyScenarioCount === 0) {
    const blockers = model?.scenarios.flatMap((entry) =>
      entry.scenario.status === "unavailable" ? entry.scenario.blockers : [],
    );
    return (
      <UnavailableMessage>
        {blockers && blockers.length > 0
          ? [...new Set(blockers)]
              .map(investmentLabFixedMixBlockerLabel)
              .join(" · ")
          : "세 가지 표준 고정비중 경로를 준비할 수 없습니다."}
      </UnavailableMessage>
    );
  }

  return (
    <div
      className="space-y-4"
      data-fixed-mix-standard-count={model.scenarios.length}
      data-fixed-mix-standard-ready={model.readyScenarioCount}
      data-section="investment-lab-fixed-mix-comparison"
    >
      <div>
        <h3 className="text-lg font-semibold">표준 비중 3안 비교</h3>
        <p className="mt-1 text-sm leading-6 text-[#687064]">
          세 안은 같은 실제 평가액 날짜, 가격·환율 근거와 매수·매도 금액을
          사용합니다. KODEX 비중 순서로만 배치하며 성과 순위나 추천을
          만들지 않습니다.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {model.scenarios.map((entry) => {
          const selected = selectedKodexWeightPct === entry.kodexWeightPct;
          return (
            <div
              className={`rounded-lg border p-4 ${
                selected
                  ? "border-[#1e3a34] bg-[#f6f9f4]"
                  : "border-[#dfe3d5] bg-[#fbfcf7]"
              }`}
              data-fixed-mix-standard-selected={selected ? "true" : "false"}
              key={entry.id}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="font-semibold">
                  KODEX {entry.kodexWeightPct}% · VOO {entry.vooWeightPct}%
                </p>
                {selected ? (
                  <span className="rounded-md bg-[#1e3a34] px-2 py-1 text-xs font-semibold text-white">
                    현재 입력
                  </span>
                ) : null}
              </div>
              {entry.scenario.status === "ready" ? (
                <dl className="mt-4 grid gap-2 text-sm">
                  <MetricRow
                    label="종료 평가액"
                    value={formatInvestmentLabKrw(
                      entry.scenario.summary.scenarioEndValueKrw,
                    )}
                  />
                  <MetricRow
                    label="실제 대비"
                    tone={
                      entry.scenario.summary.endDifferenceKrw >= 0
                        ? "positive"
                        : "negative"
                    }
                    value={formatInvestmentLabSignedKrw(
                      entry.scenario.summary.endDifferenceKrw,
                    )}
                  />
                  <MetricRow
                    label="현금흐름 조정 추정수익률"
                    tone={
                      entry.scenario.returnEstimate.scenarioReturn >= 0
                        ? "positive"
                        : "negative"
                    }
                    value={formatInvestmentLabSignedPercent(
                      entry.scenario.returnEstimate.scenarioReturn,
                    )}
                  />
                </dl>
              ) : (
                <p className="mt-4 text-sm text-[#73551b]">
                  {entry.scenario.blockers
                    .map(investmentLabFixedMixBlockerLabel)
                    .join(" · ")}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4">
        <InvestmentLabFixedMixComparisonChart scenarios={model.scenarios} />
      </div>
      {model.status === "partial" ? (
        <p className="text-sm text-[#73551b]">
          준비된 시나리오만 표시했습니다. 누락된 안은 해당 카드의 차단
          사유를 확인하세요.
        </p>
      ) : null}
    </div>
  );
}

export function isInvestmentLabStandardFixedMixPreset(value: number | null) {
  return value === 25 || value === 50 || value === 75;
}

function MetricRow({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "neutral" | "positive" | "negative";
  value: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[#687064]">{label}</dt>
      <dd
        className={`text-right font-semibold tabular-nums ${
          tone === "positive"
            ? "text-[#08784d]"
            : tone === "negative"
              ? "text-[#bd2929]"
              : "text-[#111411]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function UnavailableMessage({ children }: { children: string }) {
  return (
    <p className="rounded-md border border-[#ead9b2] bg-[#fff9ea] px-4 py-3 text-sm text-[#73551b]">
      {children}
    </p>
  );
}
