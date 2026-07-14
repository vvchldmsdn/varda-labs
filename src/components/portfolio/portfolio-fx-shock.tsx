"use client";

import { useMemo, useState } from "react";

import type { PortfolioDirectHoldingsBaseline } from "@/lib/portfolio-direct-holdings";
import {
  calculatePortfolioFxShock,
  PORTFOLIO_FX_SHOCK_POLICY,
  type PortfolioFxShockReason,
} from "@/lib/portfolio-fx-shock";

export function PortfolioFxShock({
  baseline,
  currentUsdKrwRate,
}: {
  baseline: PortfolioDirectHoldingsBaseline;
  currentUsdKrwRate: number | null;
}) {
  const [shockInput, setShockInput] = useState("5");
  const result = useMemo(
    () =>
      calculatePortfolioFxShock({
        baseline,
        currentUsdKrwRate,
        shockPct:
          shockInput.trim() === "" ? Number.NaN : Number(shockInput),
      }),
    [baseline, currentUsdKrwRate, shockInput],
  );

  return (
    <section
      aria-labelledby="portfolio-fx-shock-title"
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-applied-asset-count={result.appliedAssetCount}
      data-coverage-status={result.coverageStatus}
      data-estimated-change-krw={result.estimatedChangeKrw ?? ""}
      data-estimated-change-pct-points={
        result.estimatedChangePctPoints ?? ""
      }
      data-evaluated-asset-count={result.evaluatedAssetCount}
      data-evaluated-subset-value-krw={result.evaluatedSubsetValueKrw ?? ""}
      data-excluded-evidence-count={result.excludedEvidenceCount}
      data-fx-shock-persistence={PORTFOLIO_FX_SHOCK_POLICY.persistence}
      data-fx-shock-policy={PORTFOLIO_FX_SHOCK_POLICY.version}
      data-post-shock-subset-value-krw={
        result.estimatedPostShockSubsetValueKrw ?? ""
      }
      data-fx-shock-reason={result.reason}
      data-section="portfolio-fx-shock"
      data-fx-shock-selected-account={result.selectedAccount}
      data-shock-pct={result.shockPct ?? ""}
      data-fx-shock-status={result.status}
      data-usd-exposure-value-krw={result.usdDirectExposureValueKrw ?? ""}
      data-usd-exposure-weight-pct={result.usdDirectExposureWeightPct ?? ""}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2
            className="text-lg font-semibold tracking-normal"
            id="portfolio-fx-shock-title"
          >
            직접 보유 USD 환율 충격 실험
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-[#687064]">
            USD 직접 보유 종목의 현지 가격은 고정하고 USD/KRW만 바뀐다고
            가정합니다. 원화 상장 ETF의 해외 구성 종목은 추정하지 않습니다.
          </p>
        </div>
        <label className="flex w-full max-w-52 flex-col gap-1 text-xs font-semibold text-[#4f594e]">
          USD/KRW 변동률
          <span className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 rounded-md border border-[#cfd6c7] bg-white px-3 py-2 text-right text-sm tabular-nums outline-none focus:border-[#1e3a34]"
              inputMode="decimal"
              max={PORTFOLIO_FX_SHOCK_POLICY.maxShockPct}
              min={PORTFOLIO_FX_SHOCK_POLICY.minShockPct}
              onChange={(event) => setShockInput(event.target.value)}
              step="0.5"
              type="number"
              value={shockInput}
            />
            <span>%</span>
          </span>
        </label>
      </div>

      {result.status === "ready" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric
            detail={`${result.appliedAssetCount}개 직접 보유 종목`}
            label="USD 직접 노출"
            value={formatKrw(result.usdDirectExposureValueKrw)}
          />
          <Metric
            detail="계산 가능한 직접 보유 자산 기준"
            label="USD 비중"
            value={formatPercent(result.usdDirectExposureWeightPct)}
          />
          <Metric
            detail={`${formatNumber(result.currentUsdKrwRate)} → ${formatNumber(result.estimatedUsdKrwRate)}`}
            label="가정 환율"
            value={formatSignedPercent(result.shockPct)}
          />
          <Metric
            detail="현지 가격 고정 가정"
            label="평가액 영향"
            value={formatSignedKrw(result.estimatedChangeKrw)}
          />
          <Metric
            detail="수익률 예측이 아닌 평가액 변화폭"
            label="전체 영향"
            value={formatSignedPctPoints(result.estimatedChangePctPoints)}
          />
          <Metric
            detail={`평가 대상 ${result.evaluatedAssetCount}개`}
            label="충격 후 평가액"
            value={formatKrw(result.estimatedPostShockSubsetValueKrw)}
          />
        </div>
      ) : (
        <p className="mt-4 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-4 py-3 text-sm text-[#725f2d]">
          {reasonLabel(result.reason)}
        </p>
      )}

      <p className="mt-3 text-xs leading-5 text-[#73786c]">
        현재 계산 가능한 직접 보유 자산만 사용 · 제외/식별 불가/평가 오류 {" "}
        {result.excludedEvidenceCount}건 · 브라우저에서만 계산하며 저장하지 않음 ·
        전망, VaR, 추천, 주문 아님
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-md border border-[#e2e6da] bg-white p-3">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-2 text-lg font-semibold tracking-normal tabular-nums text-[#111411]">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-[#73786c]">{detail}</p>
    </div>
  );
}

function reasonLabel(reason: PortfolioFxShockReason) {
  switch (reason) {
    case "no_evaluable_direct_holdings":
      return "현재 계산 가능한 직접 보유 자산이 없어 환율 충격을 계산하지 않았습니다.";
    case "no_observed_usd_direct_exposure":
      return "선택한 계정에 평가액이 있는 USD 직접 보유 종목이 없습니다. 0원 영향으로 간주하지 않습니다.";
    case "invalid_current_usd_krw_rate":
      return "현재 USD/KRW 근거가 유효하지 않아 계산을 중단했습니다.";
    case "invalid_shock_pct":
      return `${PORTFOLIO_FX_SHOCK_POLICY.minShockPct}% 이상 ${PORTFOLIO_FX_SHOCK_POLICY.maxShockPct}% 이하의 변동률을 입력하세요.`;
    case "invalid_calculation":
      return "입력과 평가 근거로 유효한 결과를 만들 수 없어 계산을 중단했습니다.";
    case "ready":
      return "계산 가능";
  }
}

function formatKrw(value: number | null) {
  if (value === null) return "-";
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatSignedKrw(value: number | null) {
  if (value === null) return "-";
  const formatted = formatKrw(Math.abs(value));
  if (value === 0) return formatted;
  return `${value > 0 ? "+" : "-"}${formatted}`;
}

function formatNumber(value: number | null) {
  if (value === null) return "-";
  return value.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
}

function formatPercent(value: number | null) {
  if (value === null) return "-";
  return `${formatNumber(value)}%`;
}

function formatSignedPercent(value: number | null) {
  if (value === null) return "-";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}%`;
}

function formatSignedPctPoints(value: number | null) {
  if (value === null) return "-";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}%p`;
}
