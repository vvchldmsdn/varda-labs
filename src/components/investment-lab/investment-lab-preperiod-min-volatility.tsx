import type { InvestmentLabPreperiodMinVolatility } from "@/lib/investment-lab-preperiod-min-volatility";

export function InvestmentLabPreperiodMinVolatilityView({
  model,
}: {
  model: InvestmentLabPreperiodMinVolatility;
}) {
  const training = model.training;
  return (
    <section
      className="border-t border-[#dfe3d5] bg-[#f3f4ef] px-4 py-6"
      data-preperiod-min-volatility-candidate-common-price-dates={
        model.coverage.commonPriceDateCount
      }
      data-preperiod-min-volatility-kodex-weight-bps={
        model.weights?.kodexWeightBps ?? 0
      }
      data-preperiod-min-volatility-status={model.status}
      data-preperiod-min-volatility-training-return-observations={
        training?.returnObservationCount ?? 0
      }
      data-preperiod-min-volatility-voo-weight-bps={
        model.weights?.vooWeightBps ?? 0
      }
      data-section="investment-lab-preperiod-min-volatility"
    >
      <div className="mx-auto w-full max-w-[1500px] overflow-hidden rounded-lg border border-[#dfe3d5] bg-[#fbfcf7]">
        <div className="border-b border-[#e1e6dc] px-4 py-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold">
                기간 시작 전 최소변동성 비교
              </h2>
              <p className="mt-1 max-w-4xl text-sm leading-6 text-[#687064]">
                선택한 비교 기간보다 앞선 KODEX 200·VOO 공동 관측 60개만으로
                비중을 한 번 산정하고, 이후 실제와 같은 외부 입출금을 적용한
                연구 경로입니다.
              </p>
            </div>
            <p className="text-sm font-semibold text-[#4f584f]">
              {statusLabel(model.status)}
            </p>
          </div>
        </div>

        {training && model.weights ? (
          <div className="grid gap-px bg-[#e1e6dc] sm:grid-cols-2 xl:grid-cols-4">
            <EvidenceCell
              label="학습 구간"
              value={`${formatDate(training.startPriceDate)} ~ ${formatDate(training.endPriceDate)}`}
              detail={`${training.returnObservationCount}개 공동 수익률`}
            />
            <EvidenceCell
              label="KODEX 200 비중"
              value={formatWeight(model.weights.kodexWeightBps)}
              detail="기간 시작 전에 고정"
            />
            <EvidenceCell
              label="VOO 비중"
              value={formatWeight(model.weights.vooWeightBps)}
              detail="원화 환산 수익률 기준"
            />
            <EvidenceCell
              label="학습 구간 추정 변동성"
              value={`${training.estimatedAnnualizedVolatilityPct.toFixed(2)}%`}
              detail="공동 관측행 252 기준 연환산"
            />
          </div>
        ) : null}

        <div className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.42fr)]">
          <div>
            {model.status === "ready" ? (
              <>
                <p className="text-sm font-semibold text-[#173f38]">
                  비교 경로 계산 완료
                </p>
                <p className="mt-2 text-sm leading-6 text-[#626b5f]">
                  종료 평가액{" "}
                  {formatKrw(model.scenario.summary.scenarioEndValueKrw)} · 기간
                  수익률{" "}
                  {formatPercent(
                    model.scenario.returnEstimate.scenarioReturn,
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-[#8a641f]">
                  {model.status === "training_unavailable"
                    ? "학습 근거가 아직 부족합니다."
                    : "비중은 산정됐지만 비교 경로 근거가 부족합니다."}
                </p>
                <p className="mt-2 text-sm leading-6 text-[#6d6657]">
                  이 항목만 계산 불가로 남기며, 실제·KODEX 200·VOO 등 다른
                  유효한 비교 결과는 계속 표시합니다.
                </p>
              </>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <EvidenceRow
              label="공동 가격일"
              value={`${model.coverage.commonPriceDateCount}/61`}
            />
            <EvidenceRow
              label="제외 KODEX 일"
              value={String(model.coverage.invalidOrAmbiguousKodexDates)}
            />
            <EvidenceRow
              label="제외 VOO 일"
              value={String(model.coverage.invalidOrAmbiguousVooDates)}
            />
            <EvidenceRow
              label="제외 환율 일"
              value={String(model.coverage.invalidOrAmbiguousFxDates)}
            />
          </dl>
        </div>

        <p className="border-t border-[#e1e6dc] px-4 py-3 text-xs leading-5 text-[#73786c]">
          미래 데이터, 보간, provider backfill, 현재 보유비중, 목표비중을
          사용하지 않습니다. 거래비용·세금·주문 가능성을 반영한 추천이
          아니며, 산정 뒤 정기 리밸런싱도 하지 않습니다.
        </p>
      </div>
    </section>
  );
}

function EvidenceCell({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="bg-[#fbfcf7] px-4 py-4">
      <p className="text-xs font-semibold text-[#687064]">{label}</p>
      <p className="mt-2 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#73786c]">{detail}</p>
    </div>
  );
}

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="contents">
      <dt className="text-[#687064]">{label}</dt>
      <dd className="text-right font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function statusLabel(status: InvestmentLabPreperiodMinVolatility["status"]) {
  if (status === "ready") return "계산 가능";
  if (status === "path_unavailable") return "비중만 계산";
  return "학습 근거 부족";
}

function formatDate(value: string) {
  return value.replaceAll("-", ".");
}

function formatWeight(value: number) {
  return `${(value / 100).toFixed(value % 100 === 0 ? 0 : 2)}%`;
}

function formatKrw(value: number) {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}
