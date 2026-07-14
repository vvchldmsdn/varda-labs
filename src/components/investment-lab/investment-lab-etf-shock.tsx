"use client";

import { useState, type FormEvent } from "react";

import {
  calculateInvestmentLabEtfShock,
  investmentLabEtfShockComponentKey,
  INVESTMENT_LAB_ETF_SHOCK_POLICY,
  type InvestmentLabEtfShockResult,
} from "@/lib/investment-lab-etf-shock";
import type { InvestmentLabEtfXrayComponentRow } from "@/lib/investment-lab-etf-xray";

export function InvestmentLabEtfShock({
  components,
  excludedHoldingCount,
  exposureScope,
  uncoveredEtfExposurePct,
  valuedSubsetCurrentValueKrw,
}: {
  components: readonly InvestmentLabEtfXrayComponentRow[];
  excludedHoldingCount: number;
  exposureScope: "whole_portfolio" | "valued_subset";
  uncoveredEtfExposurePct: number;
  valuedSubsetCurrentValueKrw: number;
}) {
  const defaultComponent = components[0] ?? null;
  const [selectedKey, setSelectedKey] = useState(
    defaultComponent ? investmentLabEtfShockComponentKey(defaultComponent) : "",
  );
  const [shockPctText, setShockPctText] = useState("-10");
  const [result, setResult] = useState<InvestmentLabEtfShockResult | null>(() =>
    defaultComponent
      ? calculateInvestmentLabEtfShock({
          component: defaultComponent,
          valuedSubsetCurrentValueKrw,
          shockPct: -10,
        })
      : null,
  );
  const selectedComponent =
    components.find(
      (component) =>
        investmentLabEtfShockComponentKey(component) === selectedKey,
    ) ?? null;
  const readyResult = result?.status === "ready" ? result : null;

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedComponent) return;
    setResult(
      calculateInvestmentLabEtfShock({
        component: selectedComponent,
        valuedSubsetCurrentValueKrw,
        shockPct: parseShockPct(shockPctText),
      }),
    );
  }

  return (
    <section
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-shock-covered-exposure={readyResult?.coveredExposurePct.toFixed(6) ?? ""}
      data-shock-direct-exposure={readyResult?.directExposurePct.toFixed(6) ?? ""}
      data-shock-estimated-change-krw={readyResult?.estimatedChangeKrw.toFixed(6) ?? ""}
      data-shock-estimated-change-pct={
        readyResult?.estimatedValuedSubsetChangePercentagePoints.toFixed(6) ?? ""
      }
      data-shock-persistence={INVESTMENT_LAB_ETF_SHOCK_POLICY.persistence}
      data-shock-policy={INVESTMENT_LAB_ETF_SHOCK_POLICY.version}
      data-shock-selected-symbol={readyResult?.symbol ?? ""}
      data-shock-status={result?.status ?? "unavailable"}
      data-shock-through-etf-exposure={
        readyResult?.etfThroughExposurePct.toFixed(6) ?? ""
      }
      data-shock-value-scope={exposureScope}
      data-section="investment-lab-etf-shock"
    >
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">단일 구성종목 충격 실험</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            선택한 종목 가격만 지정한 비율로 움직인다고 가정해 직접 보유와 ETF
            경유 노출의 정적 1차 영향을 합산합니다.
          </p>
        </div>
        <p className="text-xs font-semibold text-[#687064]">입력값 저장 안 함</p>
      </div>

      {defaultComponent ? (
        <>
          <form
            className="mt-5 grid items-end gap-4 md:grid-cols-[minmax(0,1.5fr)_minmax(180px,0.6fr)_auto]"
            onSubmit={calculate}
          >
            <label className="min-w-0 text-xs font-semibold text-[#596255]">
              구성종목
              <select
                className="mt-2 h-10 w-full rounded-md border border-[#d7dccf] bg-white px-3 text-sm font-normal text-[#171916]"
                onChange={(event) => {
                  setSelectedKey(event.target.value);
                  setResult(null);
                }}
                value={selectedKey}
              >
                {components.map((component) => (
                  <option
                    key={investmentLabEtfShockComponentKey(component)}
                    value={investmentLabEtfShockComponentKey(component)}
                  >
                    {component.symbol} · {component.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="min-w-0 text-xs font-semibold text-[#596255]">
              가격 충격 (%)
              <input
                className="mt-2 h-10 w-full rounded-md border border-[#d7dccf] bg-white px-3 text-sm font-normal text-[#171916]"
                inputMode="decimal"
                max={INVESTMENT_LAB_ETF_SHOCK_POLICY.maximumShockPct}
                min={INVESTMENT_LAB_ETF_SHOCK_POLICY.minimumShockPct}
                onChange={(event) => {
                  setShockPctText(event.target.value);
                  setResult(null);
                }}
                step="0.1"
                type="number"
                value={shockPctText}
              />
            </label>

            <button
              className="h-10 rounded-md bg-[#173f38] px-5 text-sm font-semibold text-white hover:bg-[#0f302a]"
              type="submit"
            >
              계산
            </button>
          </form>

          <ShockResult result={result} />
        </>
      ) : (
        <p className="mt-4 text-sm text-[#725f2d]">
          충격을 계산할 수 있는 구성종목 근거가 없습니다.
        </p>
      )}

      <p className="mt-5 border-t border-[#e1e6dc] pt-3 text-xs leading-5 text-[#777e73]">
        {exposureScope === "whole_portfolio"
          ? "현재 평가된 전체 포트폴리오"
          : `가격·환율 근거가 있는 평가 하위집합(제외 ${excludedHoldingCount}개)`}
        을 분모로 사용합니다. 미커버 ETF 노출 {formatPercent(uncoveredEtfExposurePct)}는
        종목 identity를 알 수 없어 선택 종목 노출에 임의 배분하지 않습니다. ETF
        추적오차, 환율 변화, 다른 종목의 동반 움직임, 거래비용과 세금은 반영하지
        않으며 예측·VaR·추천·주문 결과가 아닙니다.
      </p>
    </section>
  );
}

function ShockResult({ result }: { result: InvestmentLabEtfShockResult | null }) {
  if (!result) return null;
  if (result.status === "blocked") {
    return (
      <p className="mt-4 border-t border-[#eadfbe] pt-4 text-sm text-[#725f2d]">
        {shockBlockerLabel(result.blockers[0])}
      </p>
    );
  }

  return (
    <div className="mt-5 border-t border-[#e1e6dc] pt-4">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-5">
        <ResultMetric
          label="ETF 경유 노출"
          value={formatPercent(result.etfThroughExposurePct)}
        />
        <ResultMetric
          label="직접 보유 노출"
          value={formatPercent(result.directExposurePct)}
        />
        <ResultMetric
          label="합산 관측 노출"
          value={formatPercent(result.coveredExposurePct)}
        />
        <ResultMetric
          label="평가액 영향"
          tone={result.estimatedChangeKrw}
          value={formatSignedKrw(result.estimatedChangeKrw)}
        />
        <ResultMetric
          label="평가액 변동률"
          tone={result.estimatedValuedSubsetChangePercentagePoints}
          value={formatSignedPercentagePoints(
            result.estimatedValuedSubsetChangePercentagePoints,
          )}
        />
      </div>
      <p className="mt-4 text-xs leading-5 text-[#687064]">
        {result.symbol} {formatSignedPercent(result.shockPct)} 가정 · 경유 ETF {" "}
        {result.throughEtfs.join(", ")} · 구성 근거 {" "}
        {result.asOfDates.map(formatDate).join(", ")}
        {result.mixedAsOfDates ? " (기준일 혼합)" : ""}
      </p>
    </div>
  );
}

function ResultMetric({
  label,
  tone = 0,
  value,
}: {
  label: string;
  tone?: number;
  value: string;
}) {
  return (
    <div className="border-l-2 border-[#cfd7c7] pl-3">
      <p className="text-sm text-[#687064]">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${
          tone > 0
            ? "text-[#087f4f]"
            : tone < 0
              ? "text-[#c43d39]"
              : "text-[#171916]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function parseShockPct(value: string) {
  const normalized = value.trim();
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return Number.NaN;
  return Number(normalized);
}

function shockBlockerLabel(blocker: string | undefined) {
  if (blocker === "invalid_shock_percentage") {
    return "가격 충격은 -100%부터 +100% 사이의 숫자로 입력해야 합니다.";
  }
  if (blocker === "invalid_exposure_total") {
    return "직접 보유와 ETF 경유 노출 합계가 유효 범위를 벗어났습니다.";
  }
  return "구성종목 또는 평가 근거를 확인해야 합니다.";
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatSignedPercent(value: number) {
  if (Math.abs(value) < 0.0000005) return "0.00%";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%`;
}

function formatSignedPercentagePoints(value: number) {
  if (Math.abs(value) < 0.0000005) return "0.00%p";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(2)}%p`;
}

function formatSignedKrw(value: number) {
  if (Math.abs(value) < 0.5) return "₩0";
  return `${value > 0 ? "+" : "-"}₩${Math.round(Math.abs(value)).toLocaleString("ko-KR")}`;
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}
