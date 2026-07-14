import type { PortfolioDirectHoldingsBaseline } from "@/lib/portfolio-direct-holdings";

const ACCOUNT_LABELS: Record<
  PortfolioDirectHoldingsBaseline["selectedAccount"],
  string
> = {
  brokerage: "증권",
  isa: "ISA",
  irp: "IRP",
  all: "전체",
};

export function DirectHoldingsBaseline({
  model,
}: {
  model: PortfolioDirectHoldingsBaseline;
}) {
  const metrics = model.metrics;

  return (
    <section
      aria-labelledby="direct-holdings-baseline-title"
      className="rounded-lg border border-[#dfe3d5] bg-[#fbfcf7] p-4"
      data-direct-holding-count={model.directHoldingCount}
      data-excluded-holding-count={model.excludedHoldingCount}
      data-policy={model.policy.version}
      data-section="direct-holdings-baseline"
      data-status={model.status}
      data-unresolved-identity-count={model.unresolvedIdentityCount}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            className="text-lg font-semibold tracking-normal"
            id="direct-holdings-baseline-title"
          >
            직접 보유 집중도·통화 노출
          </h2>
          <p className="mt-1 text-sm leading-6 text-[#687064]">
            {ACCOUNT_LABELS[model.selectedAccount]}의 현재 평가액을 직접 보유
            종목 기준으로 계산했습니다. ETF 내부 구성, 목표비중, 추천, 주문은
            포함하지 않습니다.
          </p>
        </div>
        <p className="text-sm font-semibold text-[#3f4b40]">
          평가 완전성 {statusLabel(model.status)}
        </p>
      </div>

      {metrics ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCell
              detail={`식별 가능한 직접 보유 ${model.directHoldingCount}개`}
              label="평가액"
              value={formatKrw(metrics.totalValueKrw)}
            />
            <MetricCell
              detail="0에 가까울수록 분산"
              label="HHI"
              value={formatNumber(metrics.hhiPoints, 0)}
            />
            <MetricCell
              detail="1 / 보유비중 제곱합"
              label="유효 종목 수"
              value={formatNumber(metrics.effectiveHoldingCount, 2)}
            />
            <MetricCell
              detail={largestHoldingLabel(model)}
              label="최대 보유비중"
              value={formatPercent(metrics.largestHoldingWeightPct)}
            />
            <MetricCell
              detail="직접 보유 상위 3개 합계"
              label="상위 3개 집중도"
              value={formatPercent(metrics.topThreeWeightPct)}
            />
          </div>

          <div className="mt-4">
            <h3 className="text-sm font-semibold text-[#30382f]">통화별 노출</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {metrics.currencyExposures.map((row) => (
                <div
                  className="rounded-md border border-[#e2e6da] bg-white p-3"
                  key={row.currency}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{row.currency}</span>
                    <span className="font-semibold tabular-nums">
                      {formatPercent(row.currentWeightPct)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs tabular-nums text-[#687064]">
                    {formatKrw(row.currentValueKrw)} · {row.holdingCount}개
                  </p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <p className="mt-4 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-4 py-3 text-sm text-[#725f2d]">
          식별 가능하고 평가액이 있는 직접 보유 종목이 없어 집중도와 통화
          노출을 계산하지 않았습니다.
        </p>
      )}

      {model.status === "partial" ? (
        <p className="mt-4 rounded-md border border-[#eadfbe] bg-[#fff9e8] px-4 py-3 text-xs leading-5 text-[#725f2d]">
          표시된 값은 확인 가능한 종목만의 부분 계산입니다. 평가 제외 {" "}
          {model.excludedHoldingCount}개 · 식별 불가 {" "}
          {model.unresolvedIdentityCount}개 · 평가액 오류 {" "}
          {model.invalidValueCount}개
        </p>
      ) : null}

      <p className="mt-3 text-xs text-[#73786c]">
        평가 근거 {model.resolvedInputHoldingCount}/{model.inputHoldingCount}행 ·
        identity: account + market + currency + ticker
      </p>
    </section>
  );
}

function MetricCell({
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
      <p className="mt-2 text-xl font-semibold tracking-normal tabular-nums text-[#111411]">
        {value}
      </p>
      <p className="mt-1 truncate text-xs text-[#73786c]" title={detail}>
        {detail}
      </p>
    </div>
  );
}

function statusLabel(status: PortfolioDirectHoldingsBaseline["status"]) {
  switch (status) {
    case "complete":
      return "완전";
    case "partial":
      return "부분 계산";
    case "unavailable":
      return "계산 불가";
  }
}

function largestHoldingLabel(model: PortfolioDirectHoldingsBaseline) {
  if (!model.largestHolding) return "-";
  return `${model.largestHolding.ticker} · ${model.largestHolding.name}`;
}

function formatKrw(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number, maximumFractionDigits: number) {
  return value.toLocaleString("ko-KR", { maximumFractionDigits });
}

function formatPercent(value: number) {
  return `${value.toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })}%`;
}
